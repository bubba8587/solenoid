import type { IsEvenOddNode as IsEvenOddNodeType, ParityOp } from "../rete-nodes";
import { PARITY_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(PARITY_OP_META) as ParityOp[]).map((op) => ({
  value: op,
  label: PARITY_OP_META[op].label,
}));

export function IsEvenOddComponent({ data, emit }: NodeProps<IsEvenOddNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
