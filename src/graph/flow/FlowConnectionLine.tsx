// [[B3]] sameNodeEverywhere, [[A1]] visualGraphCalculator
import type { ConnectionLineComponentProps } from "@xyflow/react";
import { useEffect, useSyncExternalStore } from "react";
import { getCablePath, draggedCableArgs, Position as CablePosition } from "../cablePaths";
import { cableShapeStore } from "../cableShape";
import { cableAngleStore } from "../cableAngleStore";
import { getOwningEditor } from "../activeGraph";
import { SolenoidSocket, SOCKET_COLORS } from "../sockets";

const FALLBACK_COLOR = "#7a8296";

/** The socket a dragged cable would land on, published by the drag line so the sockets don't each watch React Flow's store, which every pan frame wakes. */
let litTarget: string | null = null;
const litListeners = new Set<() => void>();
const setLitTarget = (key: string | null) => {
  if (key === litTarget) return;
  litTarget = key;
  for (const l of litListeners) l();
};
export const litTargetStore = {
  subscribe(l: () => void) { litListeners.add(l); return () => { litListeners.delete(l); }; },
  get: () => litTarget,
  key: (nodeId: string | null, socketKey: string) => `${nodeId}\0${socketKey}`,
};

function originColor(nodeId: string, handleId: string | null | undefined, side: "output" | "input"): string {
  if (!handleId) return FALLBACK_COLOR;
  const node = getOwningEditor(nodeId)?.getNode(nodeId);
  const sock = side === "output" ? node?.outputs[handleId]?.socket : node?.inputs[handleId]?.socket;
  return sock instanceof SolenoidSocket ? (SOCKET_COLORS[sock.dataType] ?? FALLBACK_COLOR) : FALLBACK_COLOR;
}

export function FlowConnectionLine({ fromNode, fromHandle, fromPosition, fromX, fromY, toX, toY, connectionStatus, toHandle }: ConnectionLineComponentProps) {
  const lit = connectionStatus === "valid" && toHandle?.id ? litTargetStore.key(toHandle.nodeId, toHandle.id) : null;
  useEffect(() => { setLitTarget(lit); }, [lit]);
  useEffect(() => () => setLitTarget(null), []);
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
