import type { DollarNode as DollarNodeType, DollarOp } from "../rete-nodes";
import { DOLLAR_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(DOLLAR_OP_META) as DollarOp[]).map((op) => ({
  value: op,
  label: DOLLAR_OP_META[op].label,
}));

export function DollarComponent({ data, emit }: NodeProps<DollarNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
