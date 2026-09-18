import type { PolyRootsNode as PolyRootsNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";

export function PolyRootsComponent({ data, emit }: NodeProps<PolyRootsNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "roots", label: "Roots", value: data.cachedRoots },
          { key: "real", label: "Real roots", value: data.cachedReal },
        ]}
      />
    </NodeShell>
  );
}
