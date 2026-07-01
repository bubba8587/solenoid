import type { DepreciationNode as DepreciationNodeType, DepreciationOp } from "../rete-nodes";
import { DEPRECIATION_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(DEPRECIATION_OP_META) as DepreciationOp[]).map((op) => ({
  value: op,
  label: DEPRECIATION_OP_META[op].label,
}));

export function DepreciationComponent({ data, emit }: NodeProps<DepreciationNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
