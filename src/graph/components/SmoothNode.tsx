import { SMOOTH_OP_META } from "../rete-nodes";
import type { SmoothNode as SmoothNodeType, SmoothOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { getActiveArea } from "../activeGraph";
import { processGraph } from "../process";

const OPS = (Object.keys(SMOOTH_OP_META) as SmoothOp[]).map((op) => ({
  value: op, label: SMOOTH_OP_META[op].label, title: SMOOTH_OP_META[op].description,
}));

export function SmoothComponent({ data, emit }: NodeProps<SmoothNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");
  async function pickOp(next: SmoothOp) {
    if (next === data.op) return;
    const departing = SMOOTH_OP_META[data.op].params.map((p) => p.key).filter((k) => !SMOOTH_OP_META[next].params.some((p) => p.key === k));
    if (departing.length) await dropInputCables(data.id, departing); // onePrunePath
    data.setOp(next);
    await getActiveArea()?.update("node", data.id);
    setOpField(next);
    await processGraph(data.id);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={OPS} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
