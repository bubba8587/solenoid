import type { CouponNode as CouponNodeType, CouponOp } from "../rete-nodes";
import { COUPON_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(COUPON_OP_META) as CouponOp[]).map(op => ({
  value: op, label: COUPON_OP_META[op].label,
}));

export function CouponComponent({ data, emit }: NodeProps<CouponNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: CouponOp) {
    setOp(next);
    setLabel(COUPON_OP_META[next].label);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
