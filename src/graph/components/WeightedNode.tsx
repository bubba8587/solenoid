import type { WeightedNode as WeightedNodeType, WeightedOp } from "../rete-nodes";
import { WEIGHTED_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(WEIGHTED_OP_META) as WeightedOp[]).map((op) => ({
  value: op,
  label: WEIGHTED_OP_META[op].label,
}));

export function WeightedComponent({ data, emit }: NodeProps<WeightedNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
