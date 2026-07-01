import type { PriceDiscNode as PriceDiscNodeType, PriceDiscOp } from "../rete-nodes";
import { PRICE_DISC_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(PRICE_DISC_OP_META) as PriceDiscOp[]).map(op => ({
  value: op, label: PRICE_DISC_OP_META[op].label,
}));

export function PriceDiscComponent({ data, emit }: NodeProps<PriceDiscNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: PriceDiscOp) { setOp(next); setLabel(PRICE_DISC_OP_META[next].label); }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
