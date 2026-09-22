// [[E11]]
// World-space layer for the Input Switch's pending-reconnect ghosts (cablePendingStore):
// a cable the One↔Many retype dropped, drawn dashed from the source `out` socket to the
// input it will reattach to, until the output type fits that socket again. No rete
// connection exists behind it, so it cannot be an RF edge; the endpoints come from RF's
// measured handle bounds. Spec: tree/specs/canvas/react-flow-surface-contract.md § Ghost cables.
import { useSyncExternalStore } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { cablePendingStore, type PendingReconnect } from "../cableState";
import { cableShapeStore } from "../cableShape";
import { socketFlipStore } from "../socketFlipStore";
import { getCablePath, Position } from "../cablePaths";
import { getOwningEditor } from "../activeGraph";
import { SOCKET_COLORS, SolenoidSocket } from "../sockets";
import "./pendingCableLayer.css";

type Pt = { x: number; y: number };

/** A socket's centre in flow space from RF's measured handle bounds; null until measured
 *  or when the node is not on this surface. */
function handleCentre(s: ReactFlowState, nodeId: string, side: "source" | "target", key: string): Pt | null {
  const n = s.nodeLookup.get(nodeId);
  const h = n?.internals.handleBounds?.[side]?.find((b) => b.id === key);
  if (!n || !h) return null;
  const at = n.internals.positionAbsolute;
  return { x: at.x + h.x + h.width / 2, y: at.y + h.y + h.height / 2 };
}

function ghostColor(p: PendingReconnect): string {
  const sock = getOwningEditor(p.target)?.getNode(p.target)?.inputs[p.targetInput]?.socket;
  return sock instanceof SolenoidSocket ? (SOCKET_COLORS[sock.dataType] ?? SOCKET_COLORS.number) : SOCKET_COLORS.number;
}

function PendingGhost({ p }: { p: PendingReconnect }) {
  // Endpoints as a value-compared pair so a drag of either node re-renders only this ghost.
  const ends = useStore(
    (s) => {
      const a = handleCentre(s, p.source, "source", p.sourceOutput);
      const b = handleCentre(s, p.target, "target", p.targetInput);
      return a && b ? `${a.x},${a.y},${b.x},${b.y}` : "";
    },
  );
  const shape = useSyncExternalStore(cableShapeStore.subscribe, cableShapeStore.get);
  const sourceFlipped = useSyncExternalStore(socketFlipStore.subscribe, () => socketFlipStore.get(p.source));
  const targetFlipped = useSyncExternalStore(socketFlipStore.subscribe, () => socketFlipStore.get(p.target));
  if (!ends) return null;
  const [sx, sy, tx, ty] = ends.split(",").map(Number);
  const d = getCablePath(shape, {
    sourceX: sx, sourceY: sy, sourcePosition: sourceFlipped ? Position.Left : Position.Right,
    targetX: tx, targetY: ty, targetPosition: targetFlipped ? Position.Right : Position.Left,
  });
  return <path className="solenoid-pending-cable" d={d} stroke={ghostColor(p)} />;
}

export function PendingCableLayer() {
  useSyncExternalStore(cablePendingStore.subscribe, cablePendingStore.version);
  const all = cablePendingStore.all();
  if (all.length === 0) return null;
  return (
    <svg className="solenoid-pending-cable-svg">
      {all.map((p) => <PendingGhost key={p.id} p={p} />)}
    </svg>
  );
}
