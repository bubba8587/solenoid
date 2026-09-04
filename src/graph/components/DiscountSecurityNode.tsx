import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps, type OpOption } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { getActiveView } from "../activeGraph";
import { processGraph } from "../process";
import { DISCOUNT_SECURITY_META, type DiscountSecurityNode as DiscountSecurityNodeType, type DiscountSecurityOp } from "../rete-nodes";

const OPS: ReadonlyArray<OpOption<DiscountSecurityOp>> = (Object.keys(DISCOUNT_SECURITY_META) as DiscountSecurityOp[]).map((op) => ({
  value: op, label: DISCOUNT_SECURITY_META[op].label, title: DISCOUNT_SECURITY_META[op].description, group: DISCOUNT_SECURITY_META[op].group,
}));

export function DiscountSecurityComponent({ data, emit }: NodeProps<DiscountSecurityNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");

  async function pickOp(next: DiscountSecurityOp) {
    if (next === data.op) return;
    const departing = data.keysDroppedBySwitch(next);
    if (departing.length > 0) await dropInputCables(data.id, departing);
    data.setOp(next);
    await getActiveView()?.rerenderNode(data.id);
    setOpField(next);
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={OPS} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
