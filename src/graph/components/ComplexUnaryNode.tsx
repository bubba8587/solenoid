import type { ComplexUnaryNode as ComplexUnaryNodeType, ComplexUnaryOp } from "../rete-nodes";
import { COMPLEX_UNARY_OP_META } from "../rete-nodes";
import { formatCxValue } from "../nodes/complex";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(COMPLEX_UNARY_OP_META) as ComplexUnaryOp[]).map((op) => ({
  value: op,
  label: COMPLEX_UNARY_OP_META[op].label,
}));

export function ComplexUnaryComponent({ data, emit }: NodeProps<ComplexUnaryNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay
        value={formatCxValue(data.cachedResult)}
        empty="—"
      />
    </NodeShell>
  );
}
