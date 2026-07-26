import { useSyncExternalStore, useState, useRef, useEffect } from "react";
import { IS_MOBILE } from "../coarse";
import { pinStore } from "../pinStore";
import { registerChrome } from "../chromeToggle";
import { cableValueStore } from "../cableValueStore";
import { connectionVersionStore, getEditor } from "../process";
import { flyToNode } from "../flyToNode";
import { nodeTypeName } from "../nodeNames";
import { GroupNode } from "../rete-nodes";
import { groupReadouts, type RetainedTerminal } from "../groupCollapse";
import { formatScalar } from "./format";
import { formatAnnotationStore, formatNumberWithAnnotation } from "../formatAnnotationStore";
import { isSolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { ArrayChip, isArrayValue, arrayAccentFor } from "./ArrayChip";
import { nodeOutputElemFamily } from "./valueDisplayFormat";
import { FrameChip, FrameRefChip } from "./FrameChip";
import { isFrameRef } from "../frameBackend";
import { CubeChip } from "./CubeChip";
import { isFrameValue, isCubeValue } from "../frame";
import "./pinLayer.css";
import { CloseIcon } from "./CloseIcon";

// The live value behind a group readout terminal — same as GroupNode's readout:
// a Display reads its cachedValue, a generic member its live output (falling back
// to cachedResult for LAMBDA-style nodes that cache there).
function readoutValue(t: RetainedTerminal): unknown {
  if (t.kind === "display") {
    return (getEditor()?.getNode(t.displayId) as { cachedValue?: unknown } | undefined)?.cachedValue;
  }
  const v = cableValueStore.get(t.effNodeId, t.effSocketKey);
  if (v !== undefined && v !== null) return v;
  return (getEditor()?.getNode(t.effNodeId) as { cachedResult?: unknown } | undefined)?.cachedResult ?? v;
}

// Format a pinned output value compactly for the HUD chip. Mirrors ValueDisplay
// but standalone (no node/FC context): scalars via formatScalar, strings
// verbatim, errors as the red #CODE! badge, null as a dash. List / table / frame
// values get the SAME clickable chip the node shows — clicking it opens the full
// grid in the shared popup (`label` titles that popup) rather than a bare [count].
function renderValue(v: unknown, label?: string, annNodeId?: string, outKey?: string) {
  if (isSolError(v)) {
    return <span className="solenoid-pin__value solenoid-pin__value--error" title={errorTip(v)}>{v.code}</span>;
  }
  if (v === null || v === undefined) return <span className="solenoid-pin__value solenoid-pin__value--empty">—</span>;
  if (isCubeValue(v)) return <CubeChip value={v} label={label} size="sm" accent="var(--sock-cube)" />;
  if (isFrameRef(v)) return <FrameRefChip frameRef={v} label={label} size="sm" accent="var(--sock-frame)" />;
  if (isFrameValue(v)) return <FrameChip value={v} label={label} size="sm" accent="var(--sock-frame)" />;
  if (isArrayValue(v)) {
    const arr = v as (number | string)[] | (number | string)[][];
    const twoD = Array.isArray(arr[0]);
    // The chip stays neutral (see pinLayer.css), but the popup header takes the
    // value's socket-type colour so it reads as that type, not the body colour.
    // From the SOCKET, not the first cell: a date list's serials look numeric and a
    // leading blank cell reads as neither, so sniffing tinted both of them amber.
    const family = nodeOutputElemFamily(annNodeId ?? null, outKey);
    return <ArrayChip value={arr} label={label} size="sm" accent={arrayAccentFor(family, twoD)} elem={family} />;
  }
  if (typeof v === "string") return <span className="solenoid-pin__value">{v || "—"}</span>;
  if (typeof v === "number") {
    // Honor the node's Format Controller (currency / % / decimals), same as the
    // node's own display + the group readouts; plain formatScalar when there's no FC.
    const ann = annNodeId ? formatAnnotationStore.getForNode(annNodeId) : undefined;
    return <span className="solenoid-pin__value">{ann ? formatNumberWithAnnotation(v, ann) : formatScalar(v)}</span>;
  }
  return <span className="solenoid-pin__value solenoid-pin__value--empty">—</span>;
}

// Lucide "pin" icon — https://lucide.dev/icons/pin
const PinSvg = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 -1.4 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

/**
 * The pinned-values HUD section: a stack of chips showing a few nodes' live
 * labels + values. Click a chip to fly to the node; × unpins. Collapses to a
 * single circle button with a count badge. Positioned by its parent
 * <HudStack/> (top-right, below the nav pill); this just renders the section.
 */
export function PinLayer() {
  // Collapsed by default everywhere: start as the compact count button (click to
  // expand). On mobile a tap outside also re-collapses it (effect below).
  const [collapsed, setCollapsed] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // Full auto-collapse on mobile: once expanded, any tap outside the layer
  // (e.g. back on the canvas) snaps it shut again, so the chips never linger
  // over the graph.
  useEffect(() => {
    if (!IS_MOBILE || collapsed) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setCollapsed(true);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [collapsed]);

  useSyncExternalStore(pinStore.subscribe, pinStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  // Labels can change (rename) and nodes can appear/vanish — re-render on topology.
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  // Re-render when a Format Controller's annotation changes, so a pinned value
  // restyles ($/%/decimals) live, matching the node's FC-formatted display.
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);

  const pins = pinStore.list();
  // Join the chrome-toggle group (Tab) only while there are pins to show.
  useEffect(() => {
    if (pins.length === 0) return;
    return registerChrome("pins", { isOpen: () => !collapsed, setOpen: (o) => setCollapsed(!o) });
  }, [collapsed, pins.length]);
  if (pins.length === 0) return null;

  const editor = getEditor();
  if (!editor) return null;

  const removeBtn = (label: string, nodeId: string) => (
    <button
      type="button"
      className="solenoid-pin__remove"
      aria-label={`Unpin ${label}`}
      title="Unpin"
      onClick={(e) => { e.stopPropagation(); pinStore.remove(nodeId); }}
    >
      <CloseIcon size={12} />
    </button>
  );

  const chips = pins.map((pin) => {
    const node = editor.getNode(pin.nodeId);
    if (!node) return null; // safety — should be dropped on delete
    const label = (node.label ?? "").trim() || nodeTypeName(node);

    // A pinned GROUP shows the same readouts a collapsed group would: a header
    // plus one row per terminal (label + live value).
    if (node instanceof GroupNode) {
      const rows = groupReadouts(editor, node);
      return (
        <div key={pin.nodeId} className="solenoid-pin solenoid-pin--group" onClick={() => flyToNode(pin.nodeId)} title="Go to this group">
          <div className="solenoid-pin__group-head">
            <span className="solenoid-pin__label">{(node.label ?? "").trim() || "Group"}</span>
            {removeBtn(label, pin.nodeId)}
          </div>
          <div className="solenoid-pin__rows">
            {rows.length === 0 ? (
              <span className="solenoid-pin__value solenoid-pin__value--empty">no readouts</span>
            ) : (
              rows.map((t) => (
                <div key={`${t.effNodeId}:${t.effSocketKey}`} className="solenoid-pin__row">
                  <span className="solenoid-pin__row-label" title={t.label}>{t.label}</span>
                  {renderValue(readoutValue(t), undefined, t.effNodeId, t.effSocketKey)}
                </div>
              ))
            )}
          </div>
        </div>
      );
    }

    const value = cableValueStore.get(pin.nodeId, pin.outputKey);
    return (
      <div key={pin.nodeId} className="solenoid-pin" onClick={() => flyToNode(pin.nodeId)} title="Go to this node">
        <span className="solenoid-pin__label">{label}</span>
        {renderValue(value, undefined, pin.nodeId, pin.outputKey)}
        {removeBtn(label, pin.nodeId)}
      </div>
    );
  });

  const trigger = (
    <button
      type="button"
      className="solenoid-pin-layer__trigger"
      title={collapsed ? `Show ${pins.length} pinned value${pins.length !== 1 ? "s" : ""}` : "Collapse pinned values"}
      onClick={() => setCollapsed((c) => !c)}
    >
      <PinSvg size={10} />
      {collapsed && <span className="solenoid-pin-layer__count">{pins.length}</span>}
    </button>
  );

  return (
    <div ref={rootRef} className={`solenoid-pin-layer${collapsed ? " solenoid-pin-layer--collapsed" : ""}`}>
      {trigger}
      {chips}
    </div>
  );
}
