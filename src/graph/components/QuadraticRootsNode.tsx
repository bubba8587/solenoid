import type { QuadraticRootsNode as QuadraticRootsNodeType } from "../rete-nodes";
import { NodeShell, InlineOutputRows, type NodeProps, type OutputRowValue } from "./nodeKit";
import { InlineInputs } from "./inlineInput";

// The roots ride RAW: OutputRowValue carries a Cx (scalar, error, or the
// broadcast LIST case — `numlist` coefficients solve a list of quadratics), and
// formatRowCell spells it. NOTE: InlineOutputRows resolves no annotation for ANY
// type, so an FC docked here doesn't reach these rows — a multi-row gap, not a
// complex one (backlog).
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
