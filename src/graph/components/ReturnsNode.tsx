import { RETURNS_OP_META } from "../rete-nodes";
import type { ReturnsNode as ReturnsNodeType, ReturnsOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { retypeOutputCables } from "../fcReconcile";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { processGraph } from "../process";

const OPS = (Object.keys(RETURNS_OP_META) as ReturnsOp[]).map((op) => ({
  value: op, label: RETURNS_OP_META[op].label, title: RETURNS_OP_META[op].description,
}));

export function ReturnsComponent({ data, emit }: NodeProps<ReturnsNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");
  async function pickOp(next: ReturnsOp) {
    if (next === data.op) return;
    const departing = RETURNS_OP_META[data.op].needs.filter((k) => !RETURNS_OP_META[next].needs.includes(k));
    if (departing.length) await dropInputCables(data.id, departing); // onePrunePath: before the swap
    const { outputChanged } = data.setOp(next);
    const editor = getActiveEditor();
    const area = getActiveArea();
    if (outputChanged && editor && area) await retypeOutputCables(editor, area, data.id, "result");
    if (area) await area.rerenderNode(data.id);
    setOpField(next);
    await processGraph(data.id);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={OPS} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
