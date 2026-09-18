import type { BitwiseNode as BitwiseNodeType, BitwiseOp } from "../rete-nodes";
import { BITWISE_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(BITWISE_OP_META) as BitwiseOp[]).map((op) => ({
  value: op,
  label: BITWISE_OP_META[op].label,
}));

export function BitwiseComponent({ data, emit }: NodeProps<BitwiseNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
