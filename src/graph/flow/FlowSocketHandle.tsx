// [[C11]] socketBox12
import { Handle, Position, useConnection, useNodeId } from "@xyflow/react";
import { SocketComponent } from "../components/SocketComponent";
import { SocketLitRing } from "../components/NodeSocket";
import type { FlowSocketProps } from "../flowSurface";

export function FlowSocketHandle({ side, socketKey, payload, shape, lit, flipped }: FlowSocketProps) {
  const nodeId = useNodeId();
  const conn = useConnection();
  const isValidTarget =
    conn.inProgress && conn.isValid === true && conn.toHandle?.nodeId === nodeId && conn.toHandle?.id === socketKey;
  const visualSide = flipped ? (side === "input" ? "output" : "input") : side;
  return (
    <Handle
      type={side === "input" ? "target" : "source"}
      position={visualSide === "input" ? Position.Left : Position.Right}
      id={socketKey}
      className="sol-rf-handle-reset"
    >
      <SocketComponent data={payload} />
      {isValidTarget && !lit && <SocketLitRing shape={shape} />}
    </Handle>
  );
}
