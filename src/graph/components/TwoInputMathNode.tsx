import { TWO_INPUT_MATH_OP_META } from "../rete-nodes";
import type { TwoInputMathNode as TwoInputMathNodeType, TwoInputMathOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(TWO_INPUT_MATH_OP_META) as TwoInputMathOp[]).map((op) => ({
  value: op,
  label: TWO_INPUT_MATH_OP_META[op].label,
}));

export function TwoInputMathComponent({ data, emit }: NodeProps<TwoInputMathNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
