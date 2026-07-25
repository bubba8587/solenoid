import type { QuadraticRootsNode as QuadraticRootsNodeType } from "../rete-nodes";
import { formatCxValue } from "../nodes/complex";
import { NodeShell, InlineOutputRows, type NodeProps, type OutputRowValue } from "./nodeKit";
import { InlineInputs } from "./inlineInput";

// formatCxValue handles the scalar, the error and the broadcast LIST cases (the
// roots take `numlist` coefficients, so a list of quadratics solves into a list
// of roots); InlineOutputRows already renders a list row.
const rootValue = (v: QuadraticRootsNodeType["cachedX1"]): OutputRowValue => formatCxValue(v);

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
