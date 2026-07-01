import type { PriceMatNode as PriceMatNodeType, PriceMatOp } from "../rete-nodes";
import { PRICE_MAT_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(PRICE_MAT_OP_META) as PriceMatOp[]).map(op => ({
  value: op, label: PRICE_MAT_OP_META[op].label,
}));

export function PriceMatComponent({ data, emit }: NodeProps<PriceMatNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: PriceMatOp) { setOp(next); setLabel(PRICE_MAT_OP_META[next].label); }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
