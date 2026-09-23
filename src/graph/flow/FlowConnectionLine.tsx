// [[C43]] oneFlowSurface, [[B10]] reactFlowView, [[C91]] cableWalkRouter
import type { ConnectionLineComponentProps } from "@xyflow/react";
import { useSyncExternalStore } from "react";
import { getCablePath, draggedCableArgs, Position as CablePosition } from "../cablePaths";
import { cableShapeStore } from "../cableShape";
import { cableAngleStore } from "../cableAngleStore";
import { getOwningEditor } from "../activeGraph";
import { SolenoidSocket, SOCKET_COLORS } from "../sockets";

const FALLBACK_COLOR = "#7a8296";

function originColor(nodeId: string, handleId: string | null | undefined, side: "output" | "input"): string {
  if (!handleId) return FALLBACK_COLOR;
  const node = getOwningEditor(nodeId)?.getNode(nodeId);
  const sock = side === "output" ? node?.outputs[handleId]?.socket : node?.inputs[handleId]?.socket;
  return sock instanceof SolenoidSocket ? (SOCKET_COLORS[sock.dataType] ?? FALLBACK_COLOR) : FALLBACK_COLOR;
}

export function FlowConnectionLine({ fromNode, fromHandle, fromPosition, fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  const shape = useSyncExternalStore(cableShapeStore.subscribe, cableShapeStore.get);
  const side = fromHandle.type === "source" ? "output" : "input";
  const color = originColor(fromNode.id, fromHandle.id, side);
  const angle = fromHandle.id ? cableAngleStore.get(fromNode.id, fromHandle.id) : null;
  const d = getCablePath(shape, draggedCableArgs(side, fromPosition as unknown as CablePosition, { x: fromX, y: fromY }, { x: toX, y: toY }, angle));
  return (
    <g className="solenoid-connection-line">
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} opacity={0.72} strokeLinecap="round" />
    </g>
  );
}
