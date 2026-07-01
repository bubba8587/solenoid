import type { BondPriceNode as BondPriceNodeType, BondPriceOp } from "../rete-nodes";
import { BOND_PRICE_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(BOND_PRICE_OP_META) as BondPriceOp[]).map((op) => ({
  value: op,
  label: BOND_PRICE_OP_META[op].label,
}));

export function BondPriceComponent({ data, emit }: NodeProps<BondPriceNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
