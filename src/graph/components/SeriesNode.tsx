// [[C113]] controlDrivenRetype
import { SERIES_OP_META } from "../rete-nodes";
import type { SeriesNode as SeriesNodeType, SeriesOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";

const OPS = (Object.keys(SERIES_OP_META) as SeriesOp[]).map((op) => ({
  value: op,
  label: SERIES_OP_META[op].label,
}));

export function SeriesComponent({ data, emit }: NodeProps<SeriesNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");

  async function pickOp(next: SeriesOp) {
    if (next === data.op) return;
    const departing = data.keysDroppedBySwitch(next);
    if (departing.length > 0) await dropInputCables(data.id, departing);
    const socketBefore = data.outputs.list?.socket;
    data.setOp(next);
    const editor = getOwningEditor(data.id);
    if (editor && data.outputs.list?.socket !== socketBefore) await retypeOutputCables(editor, getOwningView(data.id), data.id, "list");
    await getOwningView(data.id)?.rerenderNode(data.id);
    setOpField(next);
  }

  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={OPS} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
