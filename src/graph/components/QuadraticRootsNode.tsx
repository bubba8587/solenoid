import type { QuadraticRootsNode as QuadraticRootsNodeType } from "../rete-nodes";
import { formatCx } from "../rete-nodes";
import { isSolError } from "../errorValue";
import { NodeShell, InlineOutputRows, type NodeProps, type OutputRowValue } from "./nodeKit";
import { InlineInputs } from "./inlineInput";

const rootValue = (v: QuadraticRootsNodeType["cachedX1"]): OutputRowValue =>
  v === null ? null : isSolError(v) ? v : formatCx(v);

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
