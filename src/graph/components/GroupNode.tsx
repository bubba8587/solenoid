import { Fragment, useState, useRef, useEffect, useLayoutEffect, useSyncExternalStore, type CSSProperties } from "react";
import type { GroupNode as GroupNodeType } from "../rete-nodes";
import { hexToRgba, contrastInk, themeAccent, darkenAccent, resolveColor } from "../palette";
import { appThemeStore } from "../appTheme";
import { SwatchGrid } from "./SwatchGrid";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { getArea, getEditor, pushHistory, autoArrange } from "../process";
import { cableValueStore } from "../cableValueStore";
import { describeValueKind } from "../valueKindLabel";
import { valueChipFor } from "./ValueChip";
import { groupCollapseStore, syncGroupCollapse, COLLAPSE_LAYOUT, pillY, type RetainedTerminal } from "../groupCollapse";
import { SolenoidSocket, SOCKET_COLORS } from "../sockets";
import { socketHighlightStore, dragSocketKey } from "../cableState";
import { reconcileGroupBox, autofitGroupWithHistory, GROUP_MIN_W, GROUP_MIN_H } from "../groupLogic";
import { gridSnapStore, snapCoord } from "../gridSnapStore";
import { standoffStore, settleStandoffs } from "../standoffs";
import { setGroupsCollapsed } from "../groupPush";
import { rebuildGroupMembership } from "../groupMembership";
import { scheduleAutosave } from "../persistence";
import { ArrayChip, isArrayValue } from "./ArrayChip";
import { formatAnnotationStore, formatNumberWithAnnotation } from "../formatAnnotationStore";
import { isSolError } from "../errorValue";
import { ErrorChip } from "./ErrorChip";
import { formatScalar } from "./format";
import { NodeSocket } from "./NodeSocket";
import type { NodeProps } from "./nodeKit";
import "./GroupNode.css";

// Format a readout value, honoring an FC annotation keyed by `annNodeId`.
function formatReadout(v: unknown, annNodeId: string): string {
  if (v === undefined || v === null) return "—";
  // An errored member shows its #CODE! in the collapsed readout, matching the
  // red badge its own value box renders (rather than a bare "[object Object]").
  if (isSolError(v)) return v.code;
  const ann = formatAnnotationStore.getForNode(annNodeId);
  const one = (x: number) => (ann ? formatNumberWithAnnotation(x, ann) : formatScalar(x));
  if (typeof v === "number") return one(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "number" ? one(x) : String(x))).join(", ");
  // Object-valued kinds (chart / frame / cube / diagram / image / lambda) get a
  // compact label instead of "[object Object]".
  const kind = describeValueKind(v);
  if (kind != null) return kind;
  return String(v);
}

// The raw current value behind a retained terminal. Displays read their
// cachedValue; generic members read their live output, falling back to the
// node's cachedResult (LAMBDA table nodes cache there and may not be in the
// cable store yet).
function readoutValue(t: RetainedTerminal): unknown {
  if (t.kind === "display") {
    const n = getEditor()?.getNode(t.displayId) as { cachedValue?: unknown } | undefined;
    return n?.cachedValue;
  }
  const v = cableValueStore.get(t.effNodeId, t.effSocketKey);
  if (v !== undefined && v !== null) return v;
  const n = getEditor()?.getNode(t.effNodeId) as { cachedResult?: unknown } | undefined;
  return n?.cachedResult ?? v;
}

// The current readout string for a (non-array) retained terminal.
function readoutText(t: RetainedTerminal): string {
  return formatReadout(readoutValue(t), t.kind === "display" ? t.displayId : t.effNodeId);
}

// Render a (non-array) readout: an errored member shows the shared red #CODE!
// chip (with the full error tooltip), matching its own value box; an OBJECT
// kind with a chip (frame/cube/chart/document — valueChipFor, the ONE registry)
// shows its clickable chip, rendered as a DIRECT flex child so the row's
// align-items:center centers it (wrapping in the 15px row-val span baseline-
// aligned the chip low); everything else is plain formatted text.
function renderReadout(t: RetainedTerminal) {
  const v = readoutValue(t);
  if (isSolError(v)) return <ErrorChip err={v} className="solenoid-group__row-val" />;
  const chip = valueChipFor(v, {
    label: t.label,
    pinNodeId: t.kind === "display" ? t.displayId : t.effNodeId,
    size: "md",
  });
  if (chip) return chip;
  return <span className="solenoid-group__row-val">{readoutText(t)}</span>;
}


export function GroupComponent({ data, emit }: NodeProps<GroupNodeType>) {
  const node = data;
  const [label, setLabel] = useState(node.label);
  const [editingLabel, setEditingLabel] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(pickerOpen, () => setPickerOpen(false), [swatchRef, paletteRef]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Timestamp of the last grip pointerdown — used to detect a double-press
  // (autofit) without relying on the native dblclick, which the grip's
  // setPointerCapture + preventDefault suppress.
  const lastGripDown = useRef(0);

  useEffect(() => { setLabel(node.label); }, [node.label]);
  useSyncExternalStore(groupCollapseStore.subscribe, groupCollapseStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  // Combined-pill highlight tracks socket highlights (ribbon hover etc.).
  useSyncExternalStore(socketHighlightStore.subscribe, socketHighlightStore.version);
  const mode = appThemeStore.getMode();
  // Group tint reads heavier on a light canvas — give it a touch more fill.
  const fillAlpha = mode === "light" ? 0.14 : 0.08;

  // Expanded: pin BEHIND members (it's a frame). Collapsed: members are hidden,
  // so sit ABOVE the cables like a normal node — otherwise cables draw over the
  // edge pill sockets.
  useLayoutEffect(() => {
    const el = getArea()?.nodeViews.get(node.id)?.element;
    // Expanded groups sit behind members AND behind member Conduits (which are
    // at -1 so wires plug in over their grid) — so a Conduit inside a group stays
    // clickable. Layering: standoffs -3 < group -2 < conduit -1 < nodes 0. Raise
    // above everything while the color palette is open so it isn't hidden.
    if (el) el.style.zIndex = pickerOpen ? "20" : node.collapsed ? "1" : "-2";
  });

  // Draft-only while typing (project-wide rule: commit on Enter/blur, never per
  // keystroke). Escape reverts to the last committed label without writing.
  const labelCancelled = useRef(false);
  function onLabelChange(v: string) {
    setLabel(v); // draft only — node.label unchanged until commit
  }
  function commitLabel() {
    if (labelCancelled.current) { labelCancelled.current = false; setLabel(node.label); return; }
    const prev = node.label;
    const next = label;
    if (next !== prev) {
      node.label = next;
      void getArea()?.update("node", node.id);
      pushHistory(
        () => { node.label = prev; void getArea()?.update("node", node.id); },
        () => { node.label = next; void getArea()?.update("node", node.id); },
      );
    }
    setEditingLabel(false);
  }
  function onLabelKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
    else if (e.key === "Escape") { labelCancelled.current = true; e.currentTarget.blur(); }
  }

  function onResizeDown(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    // Double-press the grip → autofit the box to its members (instead of a
    // drag). Detected by hand because the native dblclick doesn't survive the
    // pointer capture + preventDefault below.
    const now = Date.now();
    if (now - lastGripDown.current < 350) {
      lastGripDown.current = 0;
      void autofitToMembers();
      return;
    }
    lastGripDown.current = now;
    const startX = e.clientX, startY = e.clientY;
    const startW = node.width, startH = node.height;
    const before = { width: startW, height: startH, members: [...node.members] };
    const area = getArea();
    const k = area?.area.transform.k ?? 1;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);

    // Apply a saved {width,height,members} snapshot (used by undo/redo).
    const applySnapshot = (s: { width: number; height: number; members: string[] }) => {
      node.width = s.width;
      node.height = s.height;
      node.members = [...s.members];
      const ed = getEditor();
      const ar = getArea();
      void ar?.update("node", node.id);
      if (ed && ar) { rebuildGroupMembership(ed); syncGroupCollapse(ed, ar); }
      scheduleAutosave();
    };

    const move = (ev: PointerEvent) => {
      node.width = Math.round(Math.max(GROUP_MIN_W, startW + (ev.clientX - startX) / k));
      node.height = Math.round(Math.max(GROUP_MIN_H, startH + (ev.clientY - startY) / k));
      void area?.update("node", node.id);
    };
    const up = () => {
      handle.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // Snap-to-grid mode: land the bottom-right corner on the grid (snap-on-
      // release, like a dropped node). The top-left stays fixed during a BR
      // resize, so snap the corner's WORLD position and derive width/height.
      if (gridSnapStore.get()) {
        const pos = area?.nodeViews.get(node.id)?.position;
        if (pos) {
          node.width = Math.round(Math.max(GROUP_MIN_W, snapCoord(pos.x + node.width) - pos.x));
          node.height = Math.round(Math.max(GROUP_MIN_H, snapCoord(pos.y + node.height) - pos.y));
          void area?.update("node", node.id);
        }
      }
      const editor = getEditor();
      if (editor && area) {
        // A MANUAL box resize DOES re-evaluate membership — dragging the edge over
        // a node to include it is a deliberate act. (Autofit is the exception: it
        // wraps the existing members and must not absorb bystanders — see
        // autofitGroupWithHistory, which omits this.)
        reconcileGroupBox(editor, area, node);
        rebuildGroupMembership(editor);
        syncGroupCollapse(editor, area);
      }
      scheduleAutosave();
      // Re-resolve standoffs against the new bbox once we let go (matches the Note
      // resize). The solver MEASURES offsetWidth/Height, so defer one frame to let
      // the resize paint; pin this group so its standoff partner re-aligns to it.
      if (!standoffStore.isEmpty()) {
        requestAnimationFrame(() => settleStandoffs(new Set([node.id])));
      }
      const after = { width: node.width, height: node.height, members: [...node.members] };
      if (after.width !== before.width || after.height !== before.height ||
          after.members.length !== before.members.length) {
        pushHistory(() => applySnapshot(before), () => applySnapshot(after));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Autofit the box to wrap its members exactly (shrink or grow). Triggered by
  // a grip double-press. Undoable, position included. Shares its body with the
  // autofit hotkey (Ctrl+Shift+F) via autofitGroupWithHistory.
  async function autofitToMembers() {
    const editor = getEditor();
    const area = getArea();
    if (!editor || !area) return;
    await autofitGroupWithHistory(editor, area, node);
  }

  // The Tidy button lays the members out within the current box (which only
  // auto-GROWS); follow it with an autofit so the box wraps the new layout exactly
  // (shrink or grow). The within-group tidy snaps docked FCs back onto their hosts
  // in a DEFERRED frame, so wait two frames (like Cleanup) before autofitting, or
  // the box would wrap the members' stale far-right ELK spots.
  async function tidyThenAutofit() {
    await autoArrange({ groupId: node.id });
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    await autofitToMembers();
  }

  function pickColor(c: string) {
    node.color = c;
    const ed = getEditor();
    void getArea()?.update("node", node.id);
    if (ed) rebuildGroupMembership(ed); // member dots follow the group color
    scheduleAutosave();
  }

  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  function toggleCollapse(e: React.MouseEvent) {
    e.stopPropagation();
    const editor = getEditor();
    const area = getArea();
    if (!editor || !area) return;
    // Centralised toggle: flip + sync + re-render + settle + push/restore.
    void setGroupsCollapsed(editor, area, [node], !node.collapsed);
  }

  // Display color is the stored color, shifted slightly for the active theme
  // (node.color stays the canonical value — a palette SLOT id, resolved to a hex
  // here). The group re-renders on theme toggle via the appThemeStore subscription.
  const baseHex = resolveColor(node.color);
  const color = themeAccent(baseHex, mode);
  const ink = contrastInk(color);
  // Light mode frames the group in a darker shade of its color (matches nodes).
  const borderCol = mode === "light" ? darkenAccent(baseHex) : color;
  const collapsed = node.collapsed;
  const retained = collapsed ? groupCollapseStore.retainedFor(node.id) : [];
  const inputPills = collapsed ? groupCollapseStore.inputPillsFor(node.id) : [];
  const rowCount = Math.max(retained.length, inputPills.length);
  const summaryMinH = rowCount * COLLAPSE_LAYOUT.rowH
    + Math.max(0, rowCount - 1) * COLLAPSE_LAYOUT.rowGap + COLLAPSE_LAYOUT.padTop * 2;

  // Publish the group color the same way a member NodeCard does (--group-color /
  // --group-color-dark), so a Table/Array chip opened from the collapsed summary
  // reads them and frames its popup with the membership border + corner triangle.
  const groupVars = {
    "--node-accent": color,
    "--group-color": color,
    "--group-color-dark": darkenAccent(baseHex),
  };
  const rootStyle = (collapsed
    ? { width: COLLAPSE_LAYOUT.width, ...groupVars }
    : { width: node.width, height: node.height, ...groupVars }) as unknown as CSSProperties;

  return (
    <div
      className={`solenoid-group${node.selected ? " solenoid-group--selected" : ""}${collapsed ? " solenoid-group--collapsed" : ""}`}
      style={rootStyle}
    >
      <div className="solenoid-group__header" style={{ background: color, borderColor: borderCol, color: ink }}>
        <button
          type="button"
          className="solenoid-group__chevron"
          title={collapsed ? "Expand group" : "Collapse group"}
          onClick={toggleCollapse}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {editingLabel ? (
          <textarea
            ref={taRef}
            className="solenoid-group__label"
            value={label}
            rows={1}
            spellCheck={false}
            placeholder="Group"
            autoFocus
            style={{ color: ink }}
            onBlur={commitLabel}
            onChange={(e) => onLabelChange(e.target.value)}
            onKeyDown={onLabelKeyDown}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="solenoid-group__label solenoid-group__label--display"
            style={{ color: ink }}
            title={label}
            onClick={() => setEditingLabel(true)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {label || "Group"}
          </div>
        )}
        {/* Tidy — auto-arrange just this group's members within its box. */}
        {node.members.length > 1 && (
          <button
            type="button"
            className="solenoid-group__tidy"
            title="Tidy group: auto-arrange members and fit the box"
            aria-label="Tidy group"
            onClick={(e) => { e.stopPropagation(); void tidyThenAutofit(); }}
            onPointerDown={stop}
            onMouseDown={stop}
          >
            <svg width="13" height="13" viewBox="-1 -1 18 18" fill="none" stroke={ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {/* One source node branching into two — a tidy graph layout. The
                  padded viewBox keeps the rounded stroke from clipping at the edges. */}
              <rect x="1.2" y="5.5" width="3.6" height="5" rx="0.8" />
              <rect x="11.2" y="2" width="3.6" height="3.6" rx="0.8" />
              <rect x="11.2" y="9.8" width="3.6" height="3.6" rx="0.8" />
              <path d="M4.8 8 H8" />
              <path d="M8 8 V3.8 H11.2" />
              <path d="M8 8 V11.6 H11.2" />
            </svg>
          </button>
        )}
        {/* Color picker — a swatch that opens the node-palette popover. */}
        <button
          ref={swatchRef}
          type="button"
          className="solenoid-group__swatch"
          title="Group color"
          onClick={(e) => { e.stopPropagation(); setPickerOpen((o) => !o); }}
          onPointerDown={stop}
          onMouseDown={stop}
        >
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke={ink} strokeWidth="1.4">
            <circle cx="6" cy="6" r="4.5" />
          </svg>
        </button>
        {pickerOpen && (
          <div ref={paletteRef} className="solenoid-group__palette" onPointerDown={stop} onMouseDown={stop}>
            <SwatchGrid value={node.color} onPick={pickColor} />
          </div>
        )}
      </div>

      {collapsed ? (
        <>
        <div className="solenoid-group__summary" style={{ borderColor: hexToRgba(borderCol, mode === "light" ? 0.65 : 0.5), background: hexToRgba(color, fillAlpha), minHeight: summaryMinH }}>
          {retained.length === 0 && inputPills.length === 0 ? (
            <div className="solenoid-group__empty">no readouts</div>
          ) : (
            retained.map((t) => {
              // A combined Conduit-output row (its outputs leave as one ribbon)
              // shows the lane count, not a single lane's value.
              const combo = (t.lanes ?? 0) > 1;
              const val = combo ? null : readoutValue(t);
              return (
                <div key={`${t.effNodeId}:${t.effSocketKey}`} className="solenoid-group__row" style={{ height: COLLAPSE_LAYOUT.rowH }}>
                  <span className="solenoid-group__row-label" title={t.label}>{t.label}</span>
                  {combo ? (
                    <span className="solenoid-group__row-val">{t.lanes} lanes</span>
                  ) : isArrayValue(val) ? (
                    <ArrayChip value={val} label={t.label} pinNodeId={t.effNodeId} />
                  ) : (
                    renderReadout(t)
                  )}
                </div>
              );
            })
          )}
        </div>
        {/* Edge pills are real sockets (so they match other sockets and the
            outputs are draggable). Inputs are ephemeral — they vanish when their
            cable breaks (recompute drops the crossing). A pill with lanes > 1 is
            the COMBINED pill a Conduit ribbon trunk terminates on: the socket
            stays functional underneath, a taller neutral stadium is the visual. */}
        {inputPills.map((ip) => {
          const sock = getEditor()?.getNode(ip.nodeId)?.inputs[ip.socketKey]?.socket;
          if (!sock) return null;
          const lanes = ip.lanes ?? 1;
          if (lanes < 2) {
            return (
              <NodeSocket key={`in${ip.nodeId}-${ip.socketKey}`} side="input" socketKey={ip.socketKey}
                          nodeId={ip.nodeId} emit={emit} payload={sock} top={pillY(ip.index) - 6} />
            );
          }
          const pillColor = sock instanceof SolenoidSocket ? SOCKET_COLORS[sock.dataType] : "#888";
          const pillLit = socketHighlightStore.isHighlighted(dragSocketKey(ip.nodeId, ip.socketKey));
          return (
            <Fragment key={`in${ip.nodeId}-${ip.socketKey}`}>
              <NodeSocket side="input" socketKey={ip.socketKey} nodeId={ip.nodeId} emit={emit}
                          payload={sock} top={pillY(ip.index) - 6} className="solenoid-node__pill-socket" />
              {/* Same stadium as the collapsed-node input pill, repositioned to
                  this pill row; lit flash matches the pill shape. */}
              <svg className="solenoid-node__input-pill" style={{ top: pillY(ip.index) - 11, height: 22 }}
                   viewBox="0 0 12 22" aria-hidden>
                <rect x="0" y="0" width="12" height="22" rx="6" fill={pillColor} />
                <rect x="1" y="1" width="10" height="20" rx="5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
                {pillLit && (
                  <rect x="0" y="0" width="12" height="22" rx="6" fill="white" fillOpacity="0.35" style={{ mixBlendMode: "overlay" }} />
                )}
              </svg>
            </Fragment>
          );
        })}
        {retained.map((t, i) => {
          const sock = getEditor()?.getNode(t.effNodeId)?.outputs[t.effSocketKey]?.socket;
          if (!sock) return null;
          // A combined Conduit-output terminal (its outputs leave as one ribbon)
          // gets the same neutral stadium as the combined INPUT pill, mirrored to
          // the right edge — the visual the fan-out ribbon emerges from.
          if ((t.lanes ?? 0) > 1) {
            const pillColor = sock instanceof SolenoidSocket ? SOCKET_COLORS[sock.dataType] : "#888";
            const pillLit = socketHighlightStore.isHighlighted(dragSocketKey(t.effNodeId, t.effSocketKey));
            return (
              <Fragment key={`out${t.effNodeId}:${t.effSocketKey}`}>
                <NodeSocket side="output" socketKey={t.effSocketKey} nodeId={t.effNodeId} emit={emit}
                            payload={sock} top={pillY(i) - 6} className="solenoid-node__pill-socket" />
                <svg className="solenoid-node__output-pill" style={{ top: pillY(i) - 11, height: 22 }}
                     viewBox="0 0 12 22" aria-hidden>
                  <rect x="0" y="0" width="12" height="22" rx="6" fill={pillColor} />
                  <rect x="1" y="1" width="10" height="20" rx="5" fill="none" stroke="var(--socket-ring)" strokeWidth="2" />
                  {pillLit && (
                    <rect x="0" y="0" width="12" height="22" rx="6" fill="white" fillOpacity="0.35" style={{ mixBlendMode: "overlay" }} />
                  )}
                </svg>
              </Fragment>
            );
          }
          return (
            <NodeSocket key={`out${t.effNodeId}:${t.effSocketKey}`} side="output" socketKey={t.effSocketKey}
                        nodeId={t.effNodeId} emit={emit} payload={sock} top={pillY(i) - 6} />
          );
        })}
        </>
      ) : (
        <div className="solenoid-group__body" style={{ borderColor: borderCol, background: hexToRgba(color, fillAlpha) }}>
          <div
            className="solenoid-group__resize"
            style={{ color }}
            onPointerDown={onResizeDown}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M11 5 5 11M11 9l-2 2" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
