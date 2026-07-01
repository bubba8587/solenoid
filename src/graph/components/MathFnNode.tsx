import type { MathFnNode as MathFnNodeType, MathFnOp } from "../rete-nodes";
import { MATH_FN_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(MATH_FN_OP_META) as MathFnOp[]).map((op) => ({
  value: op,
  label: MATH_FN_OP_META[op].label,
  group: MATH_FN_OP_META[op].group,
}));

export function MathFnComponent({ data, emit }: NodeProps<MathFnNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
