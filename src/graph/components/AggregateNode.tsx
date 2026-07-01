import type { AggregateNode as AggregateNodeType, ReduceOp } from "../rete-nodes";
import { REDUCE_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(REDUCE_OP_META) as ReduceOp[]).map((op) => ({
  value: op,
  label: REDUCE_OP_META[op].label,
}));

export function AggregateComponent({ data, emit }: NodeProps<AggregateNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
