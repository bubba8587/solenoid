import { SUM_PRODUCT_OP_META } from "../rete-nodes";
import type { SumProductNode as SumProductNodeType, SumProductOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(SUM_PRODUCT_OP_META) as SumProductOp[]).map((op) => ({
  value: op,
  label: SUM_PRODUCT_OP_META[op].label,
}));

export function SumProductComponent({ data, emit }: NodeProps<SumProductNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
