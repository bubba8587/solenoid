import { useSyncExternalStore } from "react";
import { Handle, Position, useNodeId } from "@xyflow/react";
import { SocketComponent } from "../components/SocketComponent";
import { SocketLitRing } from "../components/NodeSocket";
import type { FlowSocketProps } from "../flowSurface";
import { litTargetStore } from "./FlowConnectionLine";

export function FlowSocketHandle({ side, socketKey, payload, shape, lit, flipped }: FlowSocketProps) {
  const nodeId = useNodeId();
  const isValidTarget = useSyncExternalStore(litTargetStore.subscribe, () => litTargetStore.get() === litTargetStore.key(nodeId, socketKey));
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
