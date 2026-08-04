import type { QuadraticRootsNode as QuadraticRootsNodeType } from "../rete-nodes";
import { NodeShell, InlineOutputRows, type NodeProps, type OutputRowValue } from "./nodeKit";
import { InlineInputs } from "./inlineInput";

// Roots ride RAW — formatRowCell spells the Cx (scalar, error, or the broadcast list case).
const rootValue = (v: QuadraticRootsNodeType["cachedX1"]): OutputRowValue => v;

export function QuadraticRootsComponent({ data, emit }: NodeProps<QuadraticRootsNodeType>) {
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <InlineInputs node={data} emit={emit} />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "x1", label: "X₁", value: rootValue(data.cachedX1) },
          { key: "x2", label: "X₂", value: rootValue(data.cachedX2) },
        ]}
      />
    </NodeShell>
  );
}
