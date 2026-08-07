import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Presets } from "rete-react-plugin";
import type { ClassicPreset } from "rete";
import { cableShapeStore, type CableShape } from "../cableShape";
import { cableAngleStore } from "../cableAngleStore";
import { isolateStore } from "../isolateStore";
import { cableSelectionStore, cableGhostStore, socketHighlightStore, socketHoverCableStore, dragSocketKey } from "../cableState";
import { unselectAllNodes, getArea, connectionVersionStore } from "../process";
import { getOwningEditor, getOwningArea } from "../activeGraph";
import { getCablePath, Position } from "../cablePaths";
import { stopDragStart, IS_COARSE } from "../coarse";
import { touchSelectStore } from "../touchSelectStore";
import { SOCKET_COLORS, SolenoidSocket } from "../sockets";
import { cableValueStore } from "../cableValueStore";
import { cableFlowStore } from "../cableFlowStore";
import { loadRevealStore } from "../loadReveal";
import { groupCollapseStore, COLLAPSE_LAYOUT, pillY } from "../groupCollapse";
import { ribbonForConnection, ribbonHoverStore, conduitFacePoint, conduitLayoutStore, pinRibbonSeparation } from "../ribbonCable";
import { ConduitNode } from "../rete-nodes";
import { resolveTypedSource, conduitPath } from "../conduitTrace";
import { standoffStore } from "../standoffs";
import { settingsStore } from "../settingsStore";

const { useConnection } = Presets.classic;

const DEFAULT_COLOR = SOCKET_COLORS.number;
// Themed: white pops on the dark canvas; a dark neutral reads on light.
const SELECTED_COLOR = "var(--cable-selected)";

// Conduit ribbon trunk: a neutral "conduit cable" band, ~4× a normal cable.
const RIBBON_COLOR = "#8a909c";
const RIBBON_WIDTH = 7.2;
// How far from a Conduit face the trunk starts/stops (the lanes merge after
// leaving the source face and split before reaching the target face).
const RIBBON_SPLIT = 24;

// Invisible hit-stroke widths. A fingertip needs a much fatter target than a
// mouse pointer; the visible strokes stay the same.
const CABLE_HIT_W = IS_COARSE ? 28 : 20;
const TRUNK_HIT_W = IS_COARSE ? 30 : 22;
const FAN_HIT_W = IS_COARSE ? 24 : 14;

// Each cable's <svg> is bounded to its own content bbox with a matching `viewBox`, so
// path coords are unchanged; `overflow: visible` means the bbox need only be roughly right.
const SVG_BBOX_PAD = 64; // covers stroke half-width, corner radius, spline bow
function boundedSvgProps(
  pts: Array<{ x: number; y: number }>,
  isoDim: boolean,
  revealStyle?: React.CSSProperties,
): { className: string; style: React.CSSProperties; viewBox: string } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  minX -= SVG_BBOX_PAD; minY -= SVG_BBOX_PAD;
  maxX += SVG_BBOX_PAD; maxY += SVG_BBOX_PAD;
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  return {
    // Tags the <svg> so the gesture-time AA drop can EXCLUDE cables.
    className: "solenoid-cable-svg",
    style: {
      overflow: "visible",
      position: "absolute",
      left: minX,
      top: minY,
      width: w,
      height: h,
      pointerEvents: "none",
      ...(isoDim ? { opacity: 0.1 } : null),
      // Opacity is set only while hidden, so it never clobbers the isoDim dim above.
      ...revealStyle,
    },
    viewBox: `${minX} ${minY} ${w} ${h}`,
  };
}

// ── Flow-bead phase alignment across a ribbon assembly ────────────────────────
// Beads travel FLOW_PERIOD px per FLOW_DURATION s (keep in sync with
// .solenoid-cable-flow in canvas.css); a negative animation-delay shifts a segment's
// phase by its upstream length so beads flow continuously across an assembly.
const FLOW_PERIOD = 72;
const FLOW_DURATION = 2.25;
const flowDelay = (upstreamPx: number) =>
  `${(-((upstreamPx % FLOW_PERIOD) / FLOW_PERIOD) * FLOW_DURATION).toFixed(4)}s`;

// Measured on a detached path element (Chromium, which is what Tauri ships).
let _measurePath: SVGPathElement | null = null;
function pathLength(d: string, a: { x: number; y: number }, b: { x: number; y: number }): number {
  try {
    if (!_measurePath) {
      _measurePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    }
    _measurePath.setAttribute("d", d);
    return _measurePath.getTotalLength();
  } catch {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
}

// ── Conduit hit clearance ─────────────────────────────────────────────────────
// A compressed Conduit sits UNDER the cables, whose ~20px hit strokes would blanket it,
// so the HIT coverage (never the visible path) is dashed short of conduit endpoints.
const BLOCK_HIT_CLEAR = 14;

function hitTrimDash(total: number, trimStart: number, trimEnd: number): string | undefined {
  if (!(total > 0) || (trimStart <= 0 && trimEnd <= 0)) return undefined;
  // Never eat more than a third per side — short cables must stay clickable.
  const a = Math.min(trimStart, total / 3);
  const b = Math.min(trimEnd, total / 3);
  return `0 ${a.toFixed(1)} ${Math.max(0, total - a - b).toFixed(1)} ${b.toFixed(1)}`;
}

// ── Per-connection path cache ─────────────────────────────────────────────────
// Keyed on the geometry feeding the solver, so appearance-only re-renders reuse the string.
const _pathCache = new Map<string, { key: string; d: string }>();
// The key does NOT cover the "direct cables" toggle — clear the cache on any settings
// change or the routing won't re-solve.
settingsStore.subscribe(() => _pathCache.clear());
function cachedMainPath(
  id: string,
  shape: CableShape,
  cs: { x: number; y: number },
  ce: { x: number; y: number },
  sourceAngleDeg: number | null,
  targetAngleDeg: number | null,
): string {
  const key = `${shape}|${cs.x},${cs.y},${sourceAngleDeg}|${ce.x},${ce.y},${targetAngleDeg}`;
  const hit = _pathCache.get(id);
  if (hit && hit.key === key) return hit.d;
  const d = getCablePath(shape, {
    sourceX: cs.x, sourceY: cs.y, sourcePosition: Position.Right, sourceAngleDeg,
    targetX: ce.x, targetY: ce.y, targetPosition: Position.Left, targetAngleDeg,
  });
  _pathCache.set(id, { key, d });
  return d;
}

type ConnPayload = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;

export function ConnectionComponent({ data }: { data: ConnPayload }) {
  const { start, end } = useConnection();
  const [hovered, setHovered] = useState(false);
  const shape = useSyncExternalStore(cableShapeStore.subscribe, cableShapeStore.get);
  // Re-render when settings change so the "direct cables" perf toggle takes effect.
  useSyncExternalStore(settingsStore.subscribe, settingsStore.version);
  // Re-render when any socket's angle hint changes (a Conduit rotated, etc.).
  useSyncExternalStore(cableAngleStore.subscribe, () => 0);
  useSyncExternalStore(cableSelectionStore.subscribe, cableSelectionStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  const flow = useSyncExternalStore(cableFlowStore.subscribe, cableFlowStore.get);
  // Subscribe to ghost membership changes so a ghost commit re-renders us.
  useSyncExternalStore(cableGhostStore.subscribe, cableGhostStore.version);
  // Narrowed to kill the all-cables fan-out: a standalone cable watches only its OWN
  // hover flag; ribbon members share appearance, so they stay on the global version.
  const ribbonRef = useRef(false);
  useSyncExternalStore(
    socketHoverCableStore.subscribe,
    () => (ribbonRef.current ? socketHoverCableStore.version() : socketHoverCableStore.isHovered(data.id)),
  );
  const socketHovered = socketHoverCableStore.isHovered(data.id);
  // Hidden when it touches a member of a collapsed group.
  useSyncExternalStore(groupCollapseStore.subscribe, groupCollapseStore.version);
  // Ribbon membership tracks the connection set, and its hover is shared across components.
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  useSyncExternalStore(conduitLayoutStore.subscribe, conduitLayoutStore.version);
  const hoveredRibbonKey = useSyncExternalStore(ribbonHoverStore.subscribe, ribbonHoverStore.get);
  // Isolate: a cable recedes when either end is outside the focus set.
  useSyncExternalStore(isolateStore.subscribe, isolateStore.version);
  const isoDim = isolateStore.isActive() && !!data.source && !!data.target
    && (!isolateStore.isVisible(data.source) || !isolateStore.isVisible(data.target));

  // A revealing cable stays hidden until its turn, then draws on output → input.
  const revealActive = useSyncExternalStore(loadRevealStore.subscribe, loadRevealStore.isActive);
  const revealed = useSyncExternalStore(loadRevealStore.subscribe, () => loadRevealStore.isConnRevealed(data.id));
  const hideForReveal = revealActive && !revealed;
  const revealStyle: React.CSSProperties | undefined = revealActive
    ? (hideForReveal ? { opacity: 0, transition: "opacity 340ms ease" } : { transition: "opacity 340ms ease" })
    : undefined;

  // Must be the OWNING editor: resolving via getEditor() (main) loses the socket — and
  // so the color, ribbon bundling and hit-trim — for every drill-in cable.
  const editor = getOwningEditor(data.source || data.target);
  // Conduit-output ribbon this cable belongs to (2+ lanes to one Conduit/group).
  const ribbon = editor && data.source && data.target ? ribbonForConnection(editor, data) : null;
  const ribbonSelected =
    ribbon !== null && ribbon.members.some((m) => cableSelectionStore.has(m.id));
  const selected = cableSelectionStore.has(data.id);
  ribbonRef.current = ribbon !== null;

  // z-index only bites on rete-area's positioned holder child, not the static span
  // rete-react mounts our <svg> in — so target connectionViews' element.
  useLayoutEffect(() => {
    // Owning area, not main — a drill-in cable's holder lives in the drill-in's AreaPlugin.
    const el = getOwningArea(data.source || data.target)?.connectionViews.get(data.id)?.element;
    if (!el) return;
    el.style.zIndex = selected || ribbonSelected ? "100" : "";
    return () => { el.style.zIndex = ""; };
  }, [selected, data.id, ribbonSelected, data.source, data.target]);

  // Evict on unmount so _pathCache can't grow unbounded across create/delete churn.
  useLayoutEffect(() => () => { _pathCache.delete(data.id); }, [data.id]);

  if (groupCollapseStore.isConnHidden(data.id)) return null;

  // An endpoint on a collapsed group's hidden member redirects to the group's edge pill,
  // keyed by socket so a drag from the pill doesn't anchor at the member's 0,0.
  const pillPoint = (p: { groupId: string; side: "left" | "right"; index: number } | undefined) => {
    if (!p) return undefined;
    const g = getArea()?.nodeViews.get(p.groupId)?.position;
    if (!g) return undefined;
    return { x: p.side === "left" ? g.x : g.x + COLLAPSE_LAYOUT.width, y: g.y + pillY(p.index) };
  };
  let cs = start, ce = end;
  const outP = data.source ? pillPoint(groupCollapseStore.outPillFor(data.source, data.sourceOutput)) : undefined;
  if (outP) cs = outP;
  const inP = data.target ? pillPoint(groupCollapseStore.inPillFor(data.target, data.targetInput)) : undefined;
  if (inP) ce = inP;
  if (!cs || !ce) return null;

  const sourceAngleDeg = cableAngleStore.get(data.source, data.sourceOutput);
  const targetAngleDeg = cableAngleStore.get(data.target, data.targetInput);

  const pathD = cachedMainPath(data.id, shape, cs, ce, sourceAngleDeg, targetAngleDeg);

  const ghost = cableGhostStore.isGhost(data.id);
  const isPseudo = !data.target; // in-progress cable being drawn
  // Color follows the SOURCE socket (the target when dragging from an input); combos
  // resolve against the live value, and the trace runs through a Conduit or the lane's
  // `any` would resolve by JS value type and lose date/logical/frame colors.
  const typed = data.source ? resolveTypedSource(editor, data.source, data.sourceOutput) : null;
  const sourceSocket = typed?.socket;
  const targetSocket = editor?.getNode(data.target)?.inputs[data.targetInput]?.socket;
  const activeSocket = sourceSocket ?? targetSocket;
  const valSource = typed?.source ?? data.source;
  const valOutput = typed?.sourceOutput ?? data.sourceOutput;

  let typeColor = DEFAULT_COLOR;
  if (activeSocket instanceof SolenoidSocket) {
    const dt = activeSocket.dataType;
    const isCombo = dt === "numlist" || dt === "strcombo" || dt === "datecombo" || dt === "any" || dt === "trueany";
    if (isCombo && valSource && valOutput) {
      const val = cableValueStore.get(valSource, valOutput);
      if (val !== undefined && val !== null) {
        // Resolve the combo against the live value: arrays take the combo's
        // list color, scalars its scalar color (any falls back to value kind).
        if (Array.isArray(val)) {
          typeColor = dt === "strcombo" ? SOCKET_COLORS.strlist
            : dt === "datecombo" ? SOCKET_COLORS.datelist
            : SOCKET_COLORS.list;
        } else if (typeof val === "string") {
          typeColor = SOCKET_COLORS.string;
        } else {
          typeColor = dt === "datecombo" ? SOCKET_COLORS.date : SOCKET_COLORS.number;
        }
      } else {
        typeColor = SOCKET_COLORS[dt] ?? DEFAULT_COLOR;
      }
    } else {
      typeColor = SOCKET_COLORS[dt] ?? DEFAULT_COLOR;
    }
  }
  const stroke = selected ? SELECTED_COLOR : typeColor;
  const activeHover = hovered || socketHovered;
  const baseWidth = selected ? 2.6 : (activeHover || isPseudo) ? 2.5 : 1.8;

  // Ctrl/Cmd-click (or a tap in touch select mode) accumulates cables into a
  // multi-selection instead of replacing it — mirrors node selection.
  const accumulating = (e: React.MouseEvent) => e.ctrlKey || e.metaKey || touchSelectStore.get();

  // Double-click selects the whole RUN (every segment through the Conduits between).
  // Detected from the click's `detail` count, NOT onDoubleClick: the canvas swallows
  // native dblclick in CAPTURE phase, so React never sees a synthetic double-click.
  const selectRun = (e: React.MouseEvent) => {
    if (!editor || !data.source || !data.target) return;
    const path = conduitPath(editor, {
      id: data.id,
      source: data.source,
      sourceOutput: data.sourceOutput,
      target: data.target,
      targetInput: data.targetInput,
    });
    // A cable with no Conduit is its own run — don't toggle the first click back off.
    if (path.connIds.length < 2) return;
    cableSelectionStore.replaceAll(
      accumulating(e) ? [...cableSelectionStore.ids(), ...path.connIds] : path.connIds,
    );
    unselectAllNodes();
  };

  // Selecting a separated lane deselects its Conduit, so pin the separation open for
  // as long as this cable stays selected or the ribbon re-forms under the click.
  const pinIfSeparatedLane = () => {
    if (!editor || !data.source || !data.target) return;
    const would = ribbonForConnection(editor, data, { ignoreSeparation: true });
    if (would) {
      pinRibbonSeparation(
        would.kind === "conduit" ? [would.sourceId, would.targetId] : [would.sourceId],
        data.id,
      );
    }
  };

  // ── Conduit ribbon: trunk + fan rendering ──────────────────────────────────
  // Only the representative (lowest) lane draws the trunk; EVERY member draws its own
  // fan branches into rank-ordered slots, so branches can never cross. Hover and
  // selection are shared ribbon-wide, so the assembly behaves as one cable.
  // ── Inverse ribbon: bundle OUT of a collapsed group all the way to one dest ──
  // A Conduit hidden in a collapsed group whose outputs land on ONE destination: the
  // group's output pill IS the bundle cap, so there is no source fan.
  if (ribbon && ribbon.kind === "groupSource") {
    const tgtFace = ribbon.destKind === "conduit" ? conduitFacePoint(ribbon.targetId, "in") : null;
    if (ribbon.destKind === "group" || tgtFace) {
      const n = ribbon.members.length;
      const lane = (key: string) => Number(key.slice(key.indexOf("_") + 1));
      const slot = (rank: number) => ((rank + 0.5) / n - 0.5) * RIBBON_WIDTH;
      const isRep = ribbon.repId === data.id;
      const srcPill = cs; // source group's combined output pill — exits +x

      let trunkEnd: { x: number; y: number };
      let trunkAngle: number | null = null;
      let tgtFanD: string | null = null;
      let tgtFanLen = 0;
      if (ribbon.destKind === "conduit" && tgtFace) {
        const radT = (tgtFace.angle * Math.PI) / 180;
        const split = { x: tgtFace.x - Math.cos(radT) * RIBBON_SPLIT, y: tgtFace.y - Math.sin(radT) * RIBBON_SPLIT };
        const perpT = { x: -Math.sin(radT), y: Math.cos(radT) };
        const byTgt = [...ribbon.members].sort((a, b) => lane(a.targetInput) - lane(b.targetInput));
        const tgtRank = byTgt.findIndex((m) => m.id === data.id);
        const tgtSlot = { x: split.x + perpT.x * slot(tgtRank), y: split.y + perpT.y * slot(tgtRank) };
        tgtFanD = `M ${tgtSlot.x},${tgtSlot.y} L ${ce.x},${ce.y}`;
        tgtFanLen = Math.hypot(ce.x - tgtSlot.x, ce.y - tgtSlot.y);
        trunkEnd = split;
        trunkAngle = tgtFace.angle;
      } else {
        trunkEnd = ce; // collapsed-group destination — land whole on its pill
      }

      let trunkD: string | null = null;
      let trunkLen = 0;
      if (isRep || flow) {
        trunkD = getCablePath(shape, {
          sourceX: srcPill.x, sourceY: srcPill.y, sourcePosition: Position.Right, sourceAngleDeg: 0,
          targetX: trunkEnd.x, targetY: trunkEnd.y, targetPosition: Position.Left, targetAngleDeg: trunkAngle,
        });
        if (flow) trunkLen = pathLength(trunkD, srcPill, trunkEnd);
      }

      const ribbonHover = hovered || hoveredRibbonKey === ribbon.key
        || ribbon.members.some((m) => socketHoverCableStore.isHovered(m.id));
      const active = ribbonHover || ribbonSelected;
      const trunkStroke = ribbonSelected ? SELECTED_COLOR : RIBBON_COLOR;
      const trunkW = ribbonSelected ? RIBBON_WIDTH + 1.2 : ribbonHover ? RIBBON_WIDTH + 0.8 : RIBBON_WIDTH;
      const fanStroke = ribbonSelected ? SELECTED_COLOR : typeColor;
      const fanW = active ? 2.2 : 1.6;
      const hoverKeys = ribbon.members.flatMap((m) => [
        dragSocketKey(m.source, m.sourceOutput),
        dragSocketKey(m.target, m.targetInput),
      ]);
      const onEnter = () => { setHovered(true); ribbonHoverStore.set(ribbon.key); socketHighlightStore.setCableHover(hoverKeys); };
      const onLeave = () => { setHovered(false); ribbonHoverStore.set(null); socketHighlightStore.setCableHover([]); };
      const onRibbonClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        standoffStore.select(null);
        // Second click of a double-click: widen to this lane's whole run.
        if (e.detail >= 2) { selectRun(e); return; }
        if (accumulating(e)) {
          cableSelectionStore.toggle(ribbon.repId);
          if (cableSelectionStore.has(ribbon.repId)) unselectAllNodes();
          return;
        }
        if (ribbonSelected && cableSelectionStore.count() === 1) cableSelectionStore.set(null);
        else { cableSelectionStore.set(ribbon.repId); unselectAllNodes(); }
      };
      const hitProps = {
        fill: "none", stroke: "transparent", "data-conn-id": data.id,
        style: { cursor: "pointer", pointerEvents: "auto" } as React.CSSProperties,
        onMouseEnter: onEnter, onMouseLeave: onLeave, onClick: onRibbonClick,
        onPointerDown: stopDragStart, onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
      };
      const showTrunk = isRep && trunkD;
      // Trimmed off the source pill so its socket stays draggable.
      const trunkHitDash = showTrunk
        ? hitTrimDash(pathLength(trunkD!, srcPill, trunkEnd), BLOCK_HIT_CLEAR, ribbon.destKind === "group" ? BLOCK_HIT_CLEAR : 0)
        : undefined;
      return (
        <svg {...boundedSvgProps([cs, ce, trunkEnd], isoDim, revealStyle)}>
          {showTrunk && (
            <path d={trunkD!} fill="none" stroke={trunkStroke} strokeWidth={trunkW}
                  strokeLinecap="butt" opacity={active ? 0.95 : 0.85} pointerEvents="none" />
          )}
          {tgtFanD && (
            <path d={tgtFanD} fill="none" stroke={fanStroke} strokeWidth={fanW}
                  opacity={active ? 0.9 : 0.78} pointerEvents="none" />
          )}
          {/* Flow beads: trunk leaves the pill (phase 0); the fan continues once
              the bead reaches the trunk's end cap (trunkLen downstream). */}
          {flow && showTrunk && (
            <path className="solenoid-cable-flow" d={trunkD!} fill="none"
                  stroke={`color-mix(in srgb, ${RIBBON_COLOR} 70%, #fff)`}
                  strokeWidth={trunkW + 3.5} strokeLinecap="round" pointerEvents="none" />
          )}
          {flow && tgtFanD && (
            <path className="solenoid-cable-flow" d={tgtFanD} fill="none"
                  stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
                  strokeWidth={fanW + 3} strokeLinecap="round" pointerEvents="none"
                  style={{ animationDelay: flowDelay(trunkLen) }} />
          )}
          {showTrunk && (
            <path className="solenoid-cable-hit" d={trunkD!} strokeWidth={TRUNK_HIT_W}
                  strokeDasharray={trunkHitDash} {...hitProps} />
          )}
          {tgtFanD && (
            <path className="solenoid-cable-hit" d={tgtFanD} strokeWidth={FAN_HIT_W}
                  strokeDasharray={hitTrimDash(tgtFanLen, 0, BLOCK_HIT_CLEAR)} {...hitProps} />
          )}
        </svg>
      );
    }
    // Destination Conduit not mounted yet (first frame) — fall through to normal.
  }

  if (ribbon) {
    const srcFace = conduitFacePoint(ribbon.sourceId, "out");
    const tgtFace = ribbon.kind === "conduit" ? conduitFacePoint(ribbon.targetId, "in") : null;
    if (srcFace && (ribbon.kind === "group" || tgtFace)) {
      const isRep = ribbon.repId === data.id;
      const n = ribbon.members.length;
      const lane = (key: string) => Number(key.slice(key.indexOf("_") + 1));
      // Slot offset across the trunk's flat cap for the given rank.
      const slot = (rank: number) => ((rank + 0.5) / n - 0.5) * RIBBON_WIDTH;

      // Source side: lanes converge onto the trunk's flat starting face.
      const radS = (srcFace.angle * Math.PI) / 180;
      const merge = {
        x: srcFace.x + Math.cos(radS) * RIBBON_SPLIT,
        y: srcFace.y + Math.sin(radS) * RIBBON_SPLIT,
      };
      // Perpendicular along which lane sockets spread (laneY direction).
      const perpS = { x: -Math.sin(radS), y: Math.cos(radS) };
      const srcRank = ribbon.members.findIndex((m) => m.id === data.id);
      const srcSlot = {
        x: merge.x + perpS.x * slot(srcRank),
        y: merge.y + perpS.y * slot(srcRank),
      };
      const srcFanD = `M ${cs.x},${cs.y} L ${srcSlot.x},${srcSlot.y}`;
      const srcFanLen = Math.hypot(srcSlot.x - cs.x, srcSlot.y - cs.y);

      let trunkD: string | null = null;
      let tgtFanD: string | null = null;
      let tgtFanLen = 0;
      let trunkLen = 0; // for the target fans' flow phase
      if (ribbon.kind === "conduit" && tgtFace) {
        const radT = (tgtFace.angle * Math.PI) / 180;
        const split = {
          x: tgtFace.x - Math.cos(radT) * RIBBON_SPLIT,
          y: tgtFace.y - Math.sin(radT) * RIBBON_SPLIT,
        };
        const perpT = { x: -Math.sin(radT), y: Math.cos(radT) };
        // Rank by TARGET lane on this side so slots match socket order.
        const byTgt = [...ribbon.members].sort((a, b) => lane(a.targetInput) - lane(b.targetInput));
        const tgtRank = byTgt.findIndex((m) => m.id === data.id);
        const tgtSlot = {
          x: split.x + perpT.x * slot(tgtRank),
          y: split.y + perpT.y * slot(tgtRank),
        };
        tgtFanD = `M ${tgtSlot.x},${tgtSlot.y} L ${ce.x},${ce.y}`;
        tgtFanLen = Math.hypot(ce.x - tgtSlot.x, ce.y - tgtSlot.y);
        // Non-reps still need the trunk's LENGTH for their fan's bead phase; identical
        // inputs mean every member computes the same trunk.
        if (isRep || flow) {
          trunkD = getCablePath(shape, {
            sourceX: merge.x, sourceY: merge.y,
            sourcePosition: Position.Right, sourceAngleDeg: srcFace.angle,
            targetX: split.x, targetY: split.y,
            targetPosition: Position.Left, targetAngleDeg: tgtFace.angle,
          });
          if (flow) trunkLen = pathLength(trunkD, merge, split);
        }
      } else if (isRep) {
        // Collapsed-group target: the trunk terminates whole on the combined
        // pill (ce is already redirected there) — no target fan.
        trunkD = getCablePath(shape, {
          sourceX: merge.x, sourceY: merge.y,
          sourcePosition: Position.Right, sourceAngleDeg: srcFace.angle,
          targetX: ce.x, targetY: ce.y,
          targetPosition: Position.Left, targetAngleDeg: null,
        });
      }

      const ribbonHover =
        hovered ||
        hoveredRibbonKey === ribbon.key ||
        ribbon.members.some((m) => socketHoverCableStore.isHovered(m.id));
      const active = ribbonHover || ribbonSelected;
      const trunkStroke = ribbonSelected ? SELECTED_COLOR : RIBBON_COLOR;
      const trunkW = ribbonSelected ? RIBBON_WIDTH + 1.2 : ribbonHover ? RIBBON_WIDTH + 0.8 : RIBBON_WIDTH;
      const fanStroke = ribbonSelected ? SELECTED_COLOR : typeColor;
      const fanW = active ? 2.2 : 1.6;
      const hoverKeys = ribbon.members.flatMap((m) => [
        dragSocketKey(m.source, m.sourceOutput),
        dragSocketKey(m.target, m.targetInput),
      ]);
      const onEnter = () => {
        setHovered(true);
        ribbonHoverStore.set(ribbon.key);
        socketHighlightStore.setCableHover(hoverKeys);
      };
      const onLeave = () => {
        setHovered(false);
        ribbonHoverStore.set(null);
        socketHighlightStore.setCableHover([]);
      };
      const onRibbonClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        standoffStore.select(null);
        // Second click of a double-click: widen to this lane's whole run.
        if (e.detail >= 2) { selectRun(e); return; }
        if (accumulating(e)) {
          // Toggle the whole ribbon (its representative) in/out of the set.
          cableSelectionStore.toggle(ribbon.repId);
          if (cableSelectionStore.has(ribbon.repId)) unselectAllNodes();
          return;
        }
        if (ribbonSelected && cableSelectionStore.count() === 1) {
          cableSelectionStore.set(null);
        } else {
          cableSelectionStore.set(ribbon.repId);
          unselectAllNodes();
        }
      };
      const hitProps = {
        fill: "none",
        stroke: "transparent",
        "data-conn-id": data.id,
        style: { cursor: "pointer", pointerEvents: "auto" } as React.CSSProperties,
        onMouseEnter: onEnter,
        onMouseLeave: onLeave,
        onClick: onRibbonClick,
        onPointerDown: stopDragStart,
        onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
      };
      const fans = [srcFanD, tgtFanD].filter((d): d is string => d !== null);
      // Fan hit strokes yield near the conduit faces so the block stays clickable.
      const fanHits: Array<{ d: string; dash?: string }> = [
        { d: srcFanD, dash: hitTrimDash(srcFanLen, BLOCK_HIT_CLEAR, 0) },
      ];
      if (tgtFanD) fanHits.push({ d: tgtFanD, dash: hitTrimDash(tgtFanLen, 0, BLOCK_HIT_CLEAR) });
      const showTrunk = isRep && trunkD;
      return (
        <svg {...boundedSvgProps([cs, ce, srcFace, merge], isoDim, revealStyle)}>
          {showTrunk && (
            // Flat (butt) caps: the fans emerge side-by-side from the cut face.
            <path
              d={trunkD!} fill="none" stroke={trunkStroke} strokeWidth={trunkW}
              strokeLinecap="butt" opacity={active ? 0.95 : 0.85} pointerEvents="none"
            />
          )}
          {fans.map((d, i) => (
            <path
              key={`fan${i}`} d={d} fill="none" stroke={fanStroke} strokeWidth={fanW}
              opacity={active ? 0.9 : 0.78} pointerEvents="none"
            />
          ))}
          {/* Flow beads, phase-aligned across the assembly: source fans start
              at the sockets (phase 0), the trunk's beads start when the fan
              beads reach the merge face, the target fans continue from the
              trunk's end. The flow overlays MUST keep round caps — the beads
              are 0.01-length dashes that butt caps flatten into slivers. */}
          {flow && showTrunk && (
            <path
              className="solenoid-cable-flow" d={trunkD!} fill="none"
              stroke={`color-mix(in srgb, ${RIBBON_COLOR} 70%, #fff)`}
              strokeWidth={trunkW + 3.5} strokeLinecap="round" pointerEvents="none"
              style={{ animationDelay: flowDelay(RIBBON_SPLIT) }}
            />
          )}
          {flow && (
            <path
              className="solenoid-cable-flow" d={srcFanD} fill="none"
              stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
              strokeWidth={fanW + 3} strokeLinecap="round" pointerEvents="none"
            />
          )}
          {flow && tgtFanD && (
            <path
              className="solenoid-cable-flow" d={tgtFanD} fill="none"
              stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
              strokeWidth={fanW + 3} strokeLinecap="round" pointerEvents="none"
              style={{ animationDelay: flowDelay(RIBBON_SPLIT + trunkLen) }}
            />
          )}
          {showTrunk && <path className="solenoid-cable-hit" d={trunkD!} strokeWidth={TRUNK_HIT_W} {...hitProps} />}
          {fanHits.map((f, i) => (
            <path
              key={`fanhit${i}`} className="solenoid-cable-hit" d={f.d}
              strokeWidth={FAN_HIT_W} strokeDasharray={f.dash} {...hitProps}
            />
          ))}
        </svg>
      );
    }
    // Conduit layout not published yet (first mount) — fall through to normal.
  }

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    standoffStore.select(null);
    if (ghost) {
      // Click on a ghost commits it to a real cable.
      cableGhostStore.commit(data.id);
      cableSelectionStore.set(null);
      return;
    }
    // Second click of a double-click: widen to this cable's whole run.
    if (e.detail >= 2) { selectRun(e); return; }
    if (accumulating(e)) {
      cableSelectionStore.toggle(data.id);
      if (cableSelectionStore.has(data.id)) {
        unselectAllNodes();
        pinIfSeparatedLane();
      }
      return;
    }
    if (selected && cableSelectionStore.count() === 1) {
      // Deselects the sole selected cable; in a multi-selection it collapses to this one.
      cableSelectionStore.set(null);
    } else {
      cableSelectionStore.set(data.id);
      // Cable + node selections stay mutually exclusive.
      unselectAllNodes();
      pinIfSeparatedLane();
    }
  }

  // Hit clearance near block endpoints (see BLOCK_HIT_CLEAR above).
  const srcBlock = !!data.source && editor?.getNode(data.source) instanceof ConduitNode;
  const tgtBlock = !!data.target && editor?.getNode(data.target) instanceof ConduitNode;
  const hitDash = srcBlock || tgtBlock
    ? hitTrimDash(
        pathLength(pathD, cs, ce),
        srcBlock ? BLOCK_HIT_CLEAR : 0,
        tgtBlock ? BLOCK_HIT_CLEAR : 0,
      )
    : undefined;

  // Dash the full path length and animate the offset to 0; the path starts at the
  // source output, so the line draws output → input.
  const drawLen = revealActive ? pathLength(pathD, cs, ce) : 0;

  // The 0.72 idle value is mirrored by the gesture canvas (htmlCanvasRenderer
  // drawCables globalAlpha) — change them together or the swap pops.
  const cableOpacity = ghost ? 0.65 : activeHover || selected || isPseudo ? 0.9 : 0.72;

  return (
    <svg {...boundedSvgProps([cs, ce], isoDim, revealStyle)}>
      {<path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth={baseWidth}
        strokeDasharray={revealActive ? drawLen : ghost ? "6 5" : undefined}
        strokeDashoffset={revealActive ? (revealed ? 0 : drawLen) : undefined}
        style={revealActive ? { transition: "stroke-dashoffset 440ms ease" } : undefined}
        opacity={cableOpacity}
        pointerEvents="none"
      />}
      {/* Animated mode: a stream of beads riding the cable from output → input.
          Real, committed cables only — a half-drawn or ghost cable isn't
          carrying data yet. Beads are a brightened tint of the cable's type
          color; the flow itself is a CSS dash animation (see canvas.css). */}
      {flow && !isPseudo && !ghost && !revealActive && (
        <path
          className="solenoid-cable-flow"
          d={pathD}
          fill="none"
          stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
          strokeWidth={baseWidth + 3.5}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}
      <path
        className="solenoid-cable-hit"
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={CABLE_HIT_W}
        strokeDasharray={hitDash}
        data-conn-id={data.id}
        style={{ cursor: "pointer", pointerEvents: "auto" }}
        onMouseEnter={() => {
          setHovered(true);
          if (data.source && data.target) {
            socketHighlightStore.setCableHover([
              dragSocketKey(data.source, data.sourceOutput),
              dragSocketKey(data.target, data.targetInput),
            ]);
          }
        }}
        onMouseLeave={() => {
          setHovered(false);
          socketHighlightStore.setCableHover([]);
        }}
        onClick={onClick}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </svg>
  );
}
