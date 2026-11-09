import type { CouponNode as CouponNodeType, CouponOp } from "../nodeClasses";
import { COUPON_OP_META } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { retypeOutputCables } from "../fcReconcile";
import { getOwningView, getOwningEditor } from "../activeGraph";

const OPS = (Object.keys(COUPON_OP_META) as CouponOp[]).map(op => ({
  value: op, label: COUPON_OP_META[op].label,
}));

export function CouponComponent({ data, emit }: NodeProps<CouponNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");
  async function pickOp(next: CouponOp) {
    if (next === data.op) return;
    const outputChanged = data.setOp(next);
    const editor = getOwningEditor(data.id);
    const view = getOwningView(data.id);
    if (outputChanged && editor && view) await retypeOutputCables(editor, view, data.id, "result");
    if (view) await view.rerenderNode(data.id);
    setOpField(next);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
