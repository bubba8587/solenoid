import { ARITHMETIC_OP_META } from "../rete-nodes";
import type { ArithmeticNode as ArithmeticNodeType, ArithmeticOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(ARITHMETIC_OP_META) as ArithmeticOp[]).map((op) => ({
  value: op,
  label: ARITHMETIC_OP_META[op].label,
}));

export function ArithmeticComponent({ data, emit }: NodeProps<ArithmeticNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
