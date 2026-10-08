import type { QuadraticRootsNode as QuadraticRootsNodeType } from "../rete-nodes";
import { NodeShell, InlineOutputRows, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";

export function QuadraticRootsComponent({ data, emit }: NodeProps<QuadraticRootsNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "x1", label: "X₁", value: data.cachedX1 },
          { key: "x2", label: "X₂", value: data.cachedX2 },
        ]}
      />
    </NodeShell>
  );
}
