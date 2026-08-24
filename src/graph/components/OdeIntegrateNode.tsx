import type { OdeIntegrateNode as OdeIntegrateNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";

export function OdeIntegrateComponent({ data, emit }: NodeProps<OdeIntegrateNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "t", label: "t", value: data.cachedT },
          { key: "y", label: "y", value: data.cachedY },
        ]}
      />
    </NodeShell>
  );
}
