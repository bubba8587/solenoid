// React Flow port (C2) — the socket dot on the flow surface: an RF Handle
// (connection drag + measurement) drawing the SAME SocketComponent glyphs.
// Injected into NodeSocket via flowSurface.ts.
import { Handle, Position } from "@xyflow/react";
import { SocketComponent } from "../components/SocketComponent";
import type { FlowSocketProps } from "../flowSurface";

export function FlowSocketHandle({ side, socketKey, payload }: FlowSocketProps) {
  return (
    <Handle
      type={side === "input" ? "target" : "source"}
      position={side === "input" ? Position.Left : Position.Right}
      id={socketKey}
      className="sol-rf-handle-reset"
    >
      <SocketComponent data={payload} />
    </Handle>
  );
}
