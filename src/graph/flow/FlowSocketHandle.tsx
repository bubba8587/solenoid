// React Flow port (C2) — the socket dot on the flow surface: an RF Handle
// (connection drag + measurement) drawing the SAME SocketComponent glyphs.
// Injected into NodeSocket via flowSurface.ts.
import { Handle, Position, useConnection, useNodeId } from "@xyflow/react";
import { SocketComponent } from "../components/SocketComponent";
import { SocketLitRing } from "../components/NodeSocket";
import type { FlowSocketProps } from "../flowSurface";

export function FlowSocketHandle({ side, socketKey, payload, shape, lit }: FlowSocketProps) {
  const nodeId = useNodeId();
  // The socket a dragged cable would land on (RF snaps within connectionRadius) lights
  // once the pair validates — the same flash the app's own highlights use.
  const conn = useConnection();
  const isValidTarget =
    conn.inProgress && conn.isValid === true && conn.toHandle?.nodeId === nodeId && conn.toHandle?.id === socketKey;
  return (
    <Handle
      type={side === "input" ? "target" : "source"}
      position={side === "input" ? Position.Left : Position.Right}
      id={socketKey}
      className="sol-rf-handle-reset"
    >
      <SocketComponent data={payload} />
      {isValidTarget && !lit && <SocketLitRing shape={shape} />}
    </Handle>
  );
}
