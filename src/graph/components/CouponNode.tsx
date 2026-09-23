import type { CouponNode as CouponNodeType, CouponOp } from "../rete-nodes";
import { COUPON_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(COUPON_OP_META) as CouponOp[]).map(op => ({
  value: op, label: COUPON_OP_META[op].label,
}));

export function CouponComponent({ data, emit }: NodeProps<CouponNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  function handleOp(next: CouponOp) {
    setOp(next);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
