// React Flow port — Solenoid's cable as an RF custom edge: the FULL behavior
// of the rete surface's ConnectionComponent (which this file replaces at
// cutover): walk-router paths, type coloring, collapse-pill redirection,
// ghost cables, conduit RIBBONS (trunk + rank-ordered fans, all three kinds),
// ribbon-wide hover/selection, double-click run selection, separation pinning,
// hit-stroke trims near conduit blocks, flow beads with cross-assembly phase.
// Visible strokes are RF BaseEdges styled inline (RF's edge CSS would otherwise
// recolor a selected path); the named hit path stays the ONE pointer target.
// Not ported: the load-reveal draw-on animation (rete-holder based — ledger).
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import { getCablePath, Position as CablePosition } from "../cablePaths";
import { cableShapeStore, type CableShape } from "../cableShape";
import { cableAngleStore } from "../cableAngleStore";
import { cableSelectionStore, cableGhostStore, socketHighlightStore, socketHoverCableStore, dragSocketKey } from "../cableState";
import { cableValueStore } from "../cableValueStore";
import { cableFlowStore } from "../cableFlowStore";
import { isolateStore } from "../isolateStore";
import { resolveTypedSource, conduitPath } from "../conduitTrace";
import { ribbonForConnection, ribbonHoverStore, conduitFacePoint, conduitLayoutStore, pinRibbonSeparation } from "../ribbonCable";
import { SOCKET_COLORS, SolenoidSocket } from "../sockets";
import { unselectAllNodes } from "../process";
import { getOwningEditor, getOwningArea } from "../activeGraph";
import { groupCollapseStore, COLLAPSE_LAYOUT, pillY } from "../groupCollapse";
import { touchSelectStore } from "../touchSelectStore";
import { standoffStore } from "../standoffs";
import { settingsStore } from "../settingsStore";
import { ConduitNode } from "../rete-nodes";
import { IS_COARSE, stopDragStart } from "../coarse";

/** THE edge type of both surfaces. */
export type SolFlowEdge = Edge<Record<string, unknown>, "cable">;

const DEFAULT_COLOR = SOCKET_COLORS.number;
const SELECTED_COLOR = "var(--cable-selected)";
const RIBBON_COLOR = "#8a909c";
const RIBBON_WIDTH = 7.2;
const RIBBON_SPLIT = 24;

const CABLE_HIT_W = IS_COARSE ? 28 : 20;
const TRUNK_HIT_W = IS_COARSE ? 30 : 22;
const FAN_HIT_W = IS_COARSE ? 24 : 14;

// Beads flow continuously across an assembly: a segment's phase shifts by its
// upstream length (mirrors ConnectionComponent).
const FLOW_PERIOD = 72;
const FLOW_DURATION = 2.25;
const flowDelay = (upstreamPx: number) =>
  `${(-((upstreamPx % FLOW_PERIOD) / FLOW_PERIOD) * FLOW_DURATION).toFixed(4)}s`;

let _measurePath: SVGPathElement | null = null;
function pathLength(d: string, a: { x: number; y: number }, b: { x: number; y: number }): number {
  try {
    if (!_measurePath) _measurePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    _measurePath.setAttribute("d", d);
    return _measurePath.getTotalLength();
  } catch {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
}

// A compressed Conduit sits UNDER the cables — hit coverage (never the visible
// path) is dashed short of block endpoints so the block stays clickable.
const BLOCK_HIT_CLEAR = 14;
function hitTrimDash(total: number, trimStart: number, trimEnd: number): string | undefined {
  if (!(total > 0) || (trimStart <= 0 && trimEnd <= 0)) return undefined;
  const a = Math.min(trimStart, total / 3);
  const b = Math.min(trimEnd, total / 3);
  return `0 ${a.toFixed(1)} ${Math.max(0, total - a - b).toFixed(1)} ${b.toFixed(1)}`;
}

// Per-connection path cache, keyed on the geometry feeding the solver.
const _pathCache = new Map<string, { key: string; d: string }>();
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
    sourceX: cs.x, sourceY: cs.y, sourcePosition: CablePosition.Right, sourceAngleDeg,
    targetX: ce.x, targetY: ce.y, targetPosition: CablePosition.Left, targetAngleDeg,
  });
  _pathCache.set(id, { key, d });
  return d;
}

function typeColorFor(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): string {
  const editor = getOwningEditor(source);
  if (!editor) return DEFAULT_COLOR;
  const typed = resolveTypedSource(editor, source, sourceHandle);
  const activeSocket = typed?.socket ?? editor.getNode(target)?.inputs[targetHandle]?.socket;
  if (!(activeSocket instanceof SolenoidSocket)) return DEFAULT_COLOR;
  const dt = activeSocket.dataType;
  const isCombo = dt === "numlist" || dt === "strcombo" || dt === "datecombo" || dt === "any" || dt === "trueany";
  if (isCombo) {
    const val = cableValueStore.get(typed?.source ?? source, typed?.sourceOutput ?? sourceHandle);
    if (val !== undefined && val !== null) {
      if (Array.isArray(val)) {
        return dt === "strcombo" ? SOCKET_COLORS.strlist
          : dt === "datecombo" ? SOCKET_COLORS.datelist
          : SOCKET_COLORS.list;
      }
      if (typeof val === "string") return SOCKET_COLORS.string;
      return dt === "datecombo" ? SOCKET_COLORS.date : SOCKET_COLORS.number;
    }
  }
  return SOCKET_COLORS[dt] ?? DEFAULT_COLOR;
}

export function FlowCableEdge(props: EdgeProps<SolFlowEdge>) {
  const {
    id, source, target, sourceHandleId, targetHandleId,
    sourceX, sourceY, targetX, targetY,
  } = props;
  const [hovered, setHovered] = useState(false);
  // Owning, not main: inside the flow drill-in this edge belongs to the
  // composite's internal editor.
  const editor = getOwningEditor(source);
  const conn = {
    id,
    source,
    sourceOutput: sourceHandleId ?? "",
    target,
    targetInput: targetHandleId ?? "",
  };
  const ribbon = editor ? ribbonForConnection(editor, conn) : null;

  // Every store subscription is a PER-EDGE selector: a notify re-renders this edge
  // only when its own derived value moved (a compute pass bumps cableValueStore
  // for every cable; only a combo cable whose COLOR changes needs to repaint).
  const shape = useSyncExternalStore(cableShapeStore.subscribe, cableShapeStore.get);
  useSyncExternalStore(settingsStore.subscribe, settingsStore.version);
  const typeColor = useSyncExternalStore(
    cableValueStore.subscribe,
    () => typeColorFor(source, conn.sourceOutput, target, conn.targetInput),
  );
  const selected = useSyncExternalStore(cableSelectionStore.subscribe, () => cableSelectionStore.has(id));
  const ribbonSelected = useSyncExternalStore(
    cableSelectionStore.subscribe,
    () => ribbon !== null && ribbon.members.some((m) => cableSelectionStore.has(m.id)),
  );
  const ghost = useSyncExternalStore(cableGhostStore.subscribe, () => cableGhostStore.isGhost(id));
  const flow = useSyncExternalStore(cableFlowStore.subscribe, cableFlowStore.get);
  const isoDim = useSyncExternalStore(
    isolateStore.subscribe,
    () => isolateStore.isActive() && (!isolateStore.isVisible(source) || !isolateStore.isVisible(target)),
  );
  useSyncExternalStore(groupCollapseStore.subscribe, groupCollapseStore.version);
  // Conduit face points move only ribbons.
  useSyncExternalStore(conduitLayoutStore.subscribe, () => (ribbon ? conduitLayoutStore.version() : 0));
  const ribbonHovered = useSyncExternalStore(
    ribbonHoverStore.subscribe,
    () => ribbon !== null && ribbonHoverStore.get() === ribbon.key,
  );
  // A standalone cable watches only its OWN hover flag; ribbon members share appearance.
  const socketHovered = useSyncExternalStore(
    socketHoverCableStore.subscribe,
    () => (ribbon ? ribbon.members.some((m) => socketHoverCableStore.isHovered(m.id)) : socketHoverCableStore.isHovered(id)),
  );
  // Evict on unmount so the path cache can't grow across create/delete churn.
  useLayoutEffect(() => () => { _pathCache.delete(id); }, [id]);

  if (groupCollapseStore.isConnHidden(id)) return null;

  // An endpoint on a collapsed group's hidden member redirects to the group's
  // edge pill, keyed by socket.
  const pillPoint = (p: { groupId: string; side: "left" | "right"; index: number } | undefined) => {
    if (!p) return undefined;
    const g = getOwningArea(p.groupId)?.nodeViews.get(p.groupId)?.position;
    if (!g) return undefined;
    return { x: p.side === "left" ? g.x : g.x + COLLAPSE_LAYOUT.width, y: g.y + pillY(p.index) };
  };
  const cs = pillPoint(groupCollapseStore.outPillFor(source, conn.sourceOutput)) ?? { x: sourceX, y: sourceY };
  const ce = pillPoint(groupCollapseStore.inPillFor(target, conn.targetInput)) ?? { x: targetX, y: targetY };

  const stroke = selected ? SELECTED_COLOR : typeColor;
  const activeHover = hovered || socketHovered;
  const baseWidth = selected ? 2.6 : activeHover ? 2.5 : 1.8;
  const dimStyle = isoDim ? { opacity: 0.15 } : undefined;

  const accumulating = (e: React.MouseEvent) => e.ctrlKey || e.metaKey || touchSelectStore.get();
  const selectRun = (e: React.MouseEvent) => {
    if (!editor) return;
    const path = conduitPath(editor, conn);
    if (path.connIds.length < 2) return;
    cableSelectionStore.replaceAll(
      accumulating(e) ? [...cableSelectionStore.ids(), ...path.connIds] : path.connIds,
    );
    unselectAllNodes();
  };
  const pinIfSeparatedLane = () => {
    if (!editor) return;
    const would = ribbonForConnection(editor, conn, { ignoreSeparation: true });
    if (would) {
      pinRibbonSeparation(
        would.kind === "conduit" ? [would.sourceId, would.targetId] : [would.sourceId],
        id,
      );
    }
  };

  // Own endpoints only (a Conduit rotation re-angles just its lanes).
  const sourceAngleDeg = useSyncExternalStore(cableAngleStore.subscribe, () => cableAngleStore.get(source, conn.sourceOutput));
  const targetAngleDeg = useSyncExternalStore(cableAngleStore.subscribe, () => cableAngleStore.get(target, conn.targetInput));

  // ── Ribbons: rep draws the trunk, every member its own rank-ordered fans ──
  if (ribbon) {
    const n = ribbon.members.length;
    const lane = (key: string) => Number(key.slice(key.indexOf("_") + 1));
    const slot = (rank: number) => ((rank + 0.5) / n - 0.5) * RIBBON_WIDTH;
    const isRep = ribbon.repId === id;
    const ribbonHover = hovered || ribbonHovered || socketHovered;
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
      fill: "none",
      stroke: "transparent",
      "data-conn-id": id,
      style: { cursor: "pointer", pointerEvents: "auto" } as React.CSSProperties,
      onMouseEnter: onEnter,
      onMouseLeave: onLeave,
      onClick: onRibbonClick,
      onPointerDown: stopDragStart,
      onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    };

    if (ribbon.kind === "groupSource") {
      // Bundle OUT of a collapsed group: its output pill IS the cap — no source fan.
      const tgtFace = ribbon.destKind === "conduit" ? conduitFacePoint(ribbon.targetId, "in") : null;
      if (ribbon.destKind === "group" || tgtFace) {
        const srcPill = cs;
        let trunkEnd: { x: number; y: number };
        let trunkAngle: number | null = null;
        let tgtFanD: string | null = null;
        if (ribbon.destKind === "conduit" && tgtFace) {
          const radT = (tgtFace.angle * Math.PI) / 180;
          const split = { x: tgtFace.x - Math.cos(radT) * RIBBON_SPLIT, y: tgtFace.y - Math.sin(radT) * RIBBON_SPLIT };
          const perpT = { x: -Math.sin(radT), y: Math.cos(radT) };
          const byTgt = [...ribbon.members].sort((a, b) => lane(a.targetInput) - lane(b.targetInput));
          const tgtRank = byTgt.findIndex((m) => m.id === id);
          const tgtSlot = { x: split.x + perpT.x * slot(tgtRank), y: split.y + perpT.y * slot(tgtRank) };
          tgtFanD = `M ${tgtSlot.x},${tgtSlot.y} L ${ce.x},${ce.y}`;
          trunkEnd = split;
          trunkAngle = tgtFace.angle;
        } else {
          trunkEnd = ce;
        }
        let trunkD: string | null = null;
        let trunkLen = 0;
        if (isRep || flow) {
          trunkD = getCablePath(shape, {
            sourceX: srcPill.x, sourceY: srcPill.y, sourcePosition: CablePosition.Right, sourceAngleDeg: 0,
            targetX: trunkEnd.x, targetY: trunkEnd.y, targetPosition: CablePosition.Left, targetAngleDeg: trunkAngle,
          });
          if (flow) trunkLen = pathLength(trunkD, srcPill, trunkEnd);
        }
        const showTrunk = isRep && trunkD;
        const trunkHitDash = showTrunk
          ? hitTrimDash(pathLength(trunkD!, srcPill, trunkEnd), BLOCK_HIT_CLEAR, ribbon.destKind === "group" ? BLOCK_HIT_CLEAR : 0)
          : undefined;
        const tgtFanLen = tgtFanD ? Math.hypot(ce.x - trunkEnd.x, ce.y - trunkEnd.y) : 0;
        return (
          <g style={dimStyle}>
            {showTrunk && (
              <BaseEdge path={trunkD!} interactionWidth={0}
                        style={{ stroke: trunkStroke, strokeWidth: trunkW, strokeLinecap: "butt", opacity: active ? 0.95 : 0.85, pointerEvents: "none" }} />
            )}
            {tgtFanD && (
              <BaseEdge path={tgtFanD} interactionWidth={0}
                        style={{ stroke: fanStroke, strokeWidth: fanW, opacity: active ? 0.9 : 0.78, pointerEvents: "none" }} />
            )}
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
          </g>
        );
      }
      // Destination not mounted yet (first frame) — fall through to normal.
    } else {
      // Conduit-source ribbon (destination: another conduit, or a collapsed group).
      const srcFace = conduitFacePoint(ribbon.sourceId, "out");
      const tgtFace = ribbon.kind === "conduit" ? conduitFacePoint(ribbon.targetId, "in") : null;
      if (srcFace && (ribbon.kind === "group" || tgtFace)) {
        const radS = (srcFace.angle * Math.PI) / 180;
        const merge = { x: srcFace.x + Math.cos(radS) * RIBBON_SPLIT, y: srcFace.y + Math.sin(radS) * RIBBON_SPLIT };
        const perpS = { x: -Math.sin(radS), y: Math.cos(radS) };
        const srcRank = ribbon.members.findIndex((m) => m.id === id);
        const srcSlot = { x: merge.x + perpS.x * slot(srcRank), y: merge.y + perpS.y * slot(srcRank) };
        const srcFanD = `M ${cs.x},${cs.y} L ${srcSlot.x},${srcSlot.y}`;
        const srcFanLen = Math.hypot(srcSlot.x - cs.x, srcSlot.y - cs.y);

        let trunkD: string | null = null;
        let tgtFanD: string | null = null;
        let tgtFanLen = 0;
        let trunkLen = 0;
        if (ribbon.kind === "conduit" && tgtFace) {
          const radT = (tgtFace.angle * Math.PI) / 180;
          const split = { x: tgtFace.x - Math.cos(radT) * RIBBON_SPLIT, y: tgtFace.y - Math.sin(radT) * RIBBON_SPLIT };
          const perpT = { x: -Math.sin(radT), y: Math.cos(radT) };
          const byTgt = [...ribbon.members].sort((a, b) => lane(a.targetInput) - lane(b.targetInput));
          const tgtRank = byTgt.findIndex((m) => m.id === id);
          const tgtSlot = { x: split.x + perpT.x * slot(tgtRank), y: split.y + perpT.y * slot(tgtRank) };
          tgtFanD = `M ${tgtSlot.x},${tgtSlot.y} L ${ce.x},${ce.y}`;
          tgtFanLen = Math.hypot(ce.x - tgtSlot.x, ce.y - tgtSlot.y);
          if (isRep || flow) {
            trunkD = getCablePath(shape, {
              sourceX: merge.x, sourceY: merge.y, sourcePosition: CablePosition.Right, sourceAngleDeg: srcFace.angle,
              targetX: split.x, targetY: split.y, targetPosition: CablePosition.Left, targetAngleDeg: tgtFace.angle,
            });
            if (flow) trunkLen = pathLength(trunkD, merge, split);
          }
        } else if (isRep) {
          trunkD = getCablePath(shape, {
            sourceX: merge.x, sourceY: merge.y, sourcePosition: CablePosition.Right, sourceAngleDeg: srcFace.angle,
            targetX: ce.x, targetY: ce.y, targetPosition: CablePosition.Left, targetAngleDeg: null,
          });
        }

        const fans = [srcFanD, tgtFanD].filter((d): d is string => d !== null);
        const fanHits: Array<{ d: string; dash?: string }> = [
          { d: srcFanD, dash: hitTrimDash(srcFanLen, BLOCK_HIT_CLEAR, 0) },
        ];
        if (tgtFanD) fanHits.push({ d: tgtFanD, dash: hitTrimDash(tgtFanLen, 0, BLOCK_HIT_CLEAR) });
        const showTrunk = isRep && trunkD;
        return (
          <g style={dimStyle}>
            {showTrunk && (
              <BaseEdge path={trunkD!} interactionWidth={0}
                        style={{ stroke: trunkStroke, strokeWidth: trunkW, strokeLinecap: "butt", opacity: active ? 0.95 : 0.85, pointerEvents: "none" }} />
            )}
            {fans.map((d, i) => (
              <BaseEdge key={`fan${i}`} path={d} interactionWidth={0}
                        style={{ stroke: fanStroke, strokeWidth: fanW, opacity: active ? 0.9 : 0.78, pointerEvents: "none" }} />
            ))}
            {flow && showTrunk && (
              <path className="solenoid-cable-flow" d={trunkD!} fill="none"
                    stroke={`color-mix(in srgb, ${RIBBON_COLOR} 70%, #fff)`}
                    strokeWidth={trunkW + 3.5} strokeLinecap="round" pointerEvents="none"
                    style={{ animationDelay: flowDelay(RIBBON_SPLIT) }} />
            )}
            {flow && (
              <path className="solenoid-cable-flow" d={srcFanD} fill="none"
                    stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
                    strokeWidth={fanW + 3} strokeLinecap="round" pointerEvents="none" />
            )}
            {flow && tgtFanD && (
              <path className="solenoid-cable-flow" d={tgtFanD} fill="none"
                    stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
                    strokeWidth={fanW + 3} strokeLinecap="round" pointerEvents="none"
                    style={{ animationDelay: flowDelay(RIBBON_SPLIT + trunkLen) }} />
            )}
            {showTrunk && <path className="solenoid-cable-hit" d={trunkD!} strokeWidth={TRUNK_HIT_W} {...hitProps} />}
            {fanHits.map((f, i) => (
              <path key={`fanhit${i}`} className="solenoid-cable-hit" d={f.d}
                    strokeWidth={FAN_HIT_W} strokeDasharray={f.dash} {...hitProps} />
            ))}
          </g>
        );
      }
      // Conduit layout not published yet (first mount) — fall through to normal.
    }
  }

  // ── Plain cable ──
  const pathD = cachedMainPath(id, shape, cs, ce, sourceAngleDeg, targetAngleDeg);

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    standoffStore.select(null);
    if (ghost) {
      cableGhostStore.commit(id);
      cableSelectionStore.set(null);
      return;
    }
    if (e.detail >= 2) { selectRun(e); return; }
    if (accumulating(e)) {
      cableSelectionStore.toggle(id);
      if (cableSelectionStore.has(id)) {
        unselectAllNodes();
        pinIfSeparatedLane();
      }
      return;
    }
    if (selected && cableSelectionStore.count() === 1) {
      cableSelectionStore.set(null);
    } else {
      cableSelectionStore.set(id);
      unselectAllNodes();
      pinIfSeparatedLane();
    }
  }

  const srcBlock = editor?.getNode(source) instanceof ConduitNode;
  const tgtBlock = editor?.getNode(target) instanceof ConduitNode;
  const hitDash = srcBlock || tgtBlock
    ? hitTrimDash(pathLength(pathD, cs, ce), srcBlock ? BLOCK_HIT_CLEAR : 0, tgtBlock ? BLOCK_HIT_CLEAR : 0)
    : undefined;
  // The 0.72 idle value is mirrored by the gesture canvas — change together.
  const cableOpacity = ghost ? 0.65 : activeHover || selected ? 0.9 : 0.72;

  return (
    <g style={dimStyle}>
      <BaseEdge
        path={pathD}
        interactionWidth={0}
        style={{
          stroke,
          strokeWidth: baseWidth,
          strokeDasharray: ghost ? "6 5" : undefined,
          opacity: cableOpacity,
          pointerEvents: "none",
        }}
      />
      {flow && !ghost && (
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
        data-conn-id={id}
        style={{ cursor: "pointer", pointerEvents: "auto" }}
        onMouseEnter={() => {
          setHovered(true);
          socketHighlightStore.setCableHover([
            dragSocketKey(source, conn.sourceOutput),
            dragSocketKey(target, conn.targetInput),
          ]);
        }}
        onMouseLeave={() => {
          setHovered(false);
          socketHighlightStore.setCableHover([]);
        }}
        onClick={onClick}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </g>
  );
}
