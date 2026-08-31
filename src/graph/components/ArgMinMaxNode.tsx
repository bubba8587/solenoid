import { ARG_MIN_MAX_OP_META } from "../rete-nodes";
import type { ArgMinMaxNode as ArgMinMaxNodeType, ArgMinMaxOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { retypeOutputCables } from "../fcReconcile";
import { getActiveEditor, getActiveView } from "../activeGraph";
import { processGraph } from "../process";
const OPS = (Object.keys(ARG_MIN_MAX_OP_META) as ArgMinMaxOp[]).map((op) => ({
  value: op,
  label: ARG_MIN_MAX_OP_META[op].label,
  title: ARG_MIN_MAX_OP_META[op].description,
}));

export function ArgMinMaxComponent({ data, emit }: NodeProps<ArgMinMaxNodeType>) {
  const [op, setOpField] = useNodeField(data, "op");
  async function pickOp(next: ArgMinMaxOp) {
    if (next === data.op) return;
    // WHICH swaps the input family (number ↔ logical list): prune BEFORE the in-place
    // retype (onePrunePath); the output rank swap (number ↔ list) prunes after.
    if ((next === "which") !== (data.op === "which")) await dropInputCables(data.id, ["list"]);
    const { outputChanged } = data.setOp(next);
    const editor = getActiveEditor();
    const view = getActiveView();
    if (outputChanged && editor && view) await retypeOutputCables(editor, view, data.id, "result");
    if (view) await view.rerenderNode(data.id);
    setOpField(next);
    await processGraph(data.id);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
