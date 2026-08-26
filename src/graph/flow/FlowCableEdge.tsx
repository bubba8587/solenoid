// React Flow port (C3) — Solenoid's cable as an RF custom edge: the SAME walk
// router (cablePaths.ts), type coloring (combo resolved against the live
// value, traced through Conduits), selection color, flow beads, isolate dim.
// Ribbons/ghost/reveal stay on the ledger. RF draws its own 20px interaction
// path, so hit-targets and click selection come from the edge wrapper.
import { useSyncExternalStore } from "react";
import type { EdgeProps } from "@xyflow/react";
import { getCablePath, Position as CablePosition } from "../cablePaths";
import { cableShapeStore } from "../cableShape";
import { cableAngleStore } from "../cableAngleStore";
import { cableSelectionStore } from "../cableState";
import { cableValueStore } from "../cableValueStore";
import { cableFlowStore } from "../cableFlowStore";
import { isolateStore } from "../isolateStore";
import { resolveTypedSource } from "../conduitTrace";
import { SOCKET_COLORS, SolenoidSocket } from "../sockets";
import { getEditor, getArea } from "../process";
import { groupCollapseStore, COLLAPSE_LAYOUT, pillY } from "../groupCollapse";

const DEFAULT_COLOR = SOCKET_COLORS.number;
const SELECTED_COLOR = "var(--cable-selected)";

function typeColorFor(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): string {
  const editor = getEditor();
  if (!editor) return DEFAULT_COLOR;
  const typed = resolveTypedSource(editor, source, sourceHandle);
  const sourceSocket = typed?.socket;
  const targetSocket = editor.getNode(target)?.inputs[targetHandle]?.socket;
  const activeSocket = sourceSocket ?? targetSocket;
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

export function FlowCableEdge(props: EdgeProps) {
  const {
    id, source, target, sourceHandleId, targetHandleId,
    sourceX, sourceY, targetX, targetY, selected,
  } = props;
  const shape = useSyncExternalStore(cableShapeStore.subscribe, cableShapeStore.get);
  useSyncExternalStore(cableAngleStore.subscribe, () => 0);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  useSyncExternalStore(cableSelectionStore.subscribe, cableSelectionStore.version);
  const flow = useSyncExternalStore(cableFlowStore.subscribe, cableFlowStore.get);
  useSyncExternalStore(isolateStore.subscribe, isolateStore.version);
  useSyncExternalStore(groupCollapseStore.subscribe, groupCollapseStore.version);

  // Cables between two hidden members of a collapsed group disappear; an
  // endpoint on a hidden member redirects to the group's edge pill (same rule
  // as the rete surface's ConnectionComponent).
  if (groupCollapseStore.isConnHidden(id)) return null;
  const pillPoint = (p: { groupId: string; side: "left" | "right"; index: number } | undefined) => {
    if (!p) return undefined;
    const g = getArea()?.nodeViews.get(p.groupId)?.position;
    if (!g) return undefined;
    return { x: p.side === "left" ? g.x : g.x + COLLAPSE_LAYOUT.width, y: g.y + pillY(p.index) };
  };
  const outP = pillPoint(groupCollapseStore.outPillFor(source, sourceHandleId ?? ""));
  const inP = pillPoint(groupCollapseStore.inPillFor(target, targetHandleId ?? ""));

  const sourceAngleDeg = cableAngleStore.get(source, sourceHandleId ?? "");
  const targetAngleDeg = cableAngleStore.get(target, targetHandleId ?? "");
  const d = getCablePath(shape, {
    sourceX: outP?.x ?? sourceX,
    sourceY: outP?.y ?? sourceY,
    sourcePosition: CablePosition.Right,
    sourceAngleDeg,
    targetX: inP?.x ?? targetX,
    targetY: inP?.y ?? targetY,
    targetPosition: CablePosition.Left,
    targetAngleDeg,
  });

  const isSelected = selected || cableSelectionStore.has(id);
  const typeColor = typeColorFor(source, sourceHandleId ?? "", target, targetHandleId ?? "");
  const stroke = isSelected ? SELECTED_COLOR : typeColor;
  const isoDim = isolateStore.isActive()
    && (!isolateStore.isVisible(source) || !isolateStore.isVisible(target));

  return (
    <g style={isoDim ? { opacity: 0.15 } : undefined}>
      {/* The named hit path: context-menu targeting and press-clearing logic
          find cables via `path.solenoid-cable-hit[data-conn-id]`. */}
      <path
        className="solenoid-cable-hit"
        data-conn-id={id}
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
      />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={isSelected ? 2.6 : 1.8}
        strokeLinecap="round"
        pointerEvents="none"
      />
      {flow && (
        <path
          className="solenoid-cable-flow"
          d={d}
          fill="none"
          stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
          strokeWidth={4.6}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}
    </g>
  );
}
