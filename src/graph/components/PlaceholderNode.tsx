import { NodeShell, PortSockets, type NodeProps } from "./nodeKit";
import type { PlaceholderNode } from "../rete-nodes";
import "./placeholderNode.css";

// Renders a missing-type node (see PlaceholderNode): the original type name in
// red, a short explanation, and the synthesized input sockets (NodeShell draws
// the outputs) so the preserved cables stay attached and visible.
export function PlaceholderComponent({ data, emit }: NodeProps<PlaceholderNode>) {
  return (
    <NodeShell
      node={data}
      emit={emit}
      className="solenoid-node--placeholder"
      leading={<PortSockets node={data} emit={emit} side="input" />}
    >
      <div className="solenoid-placeholder">
        <div className="solenoid-placeholder__type" title={data.missingType}>{data.missingType}</div>
        <div className="solenoid-placeholder__msg">
          This node type isn’t available here. Its connections and data are kept.
          Turn its pack on, or open the file in a build that has it, to restore the node.
        </div>
      </div>
    </NodeShell>
  );
}
