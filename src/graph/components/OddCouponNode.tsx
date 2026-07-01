import type { OddCouponNode as OddCouponNodeType, OddCouponOp } from "../rete-nodes";
import { ODD_COUPON_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(ODD_COUPON_OP_META) as OddCouponOp[]).map((op) => ({
  value: op,
  label: ODD_COUPON_OP_META[op].label,
}));

export function OddCouponComponent({ data, emit }: NodeProps<OddCouponNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
