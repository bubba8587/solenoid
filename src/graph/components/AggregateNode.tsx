import type { AggregateNode as AggregateNodeType, ReduceOp } from "../nodeClasses";
import { REDUCE_OP_META } from "../nodeClasses";
import { useState } from "react";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, type NodeProps } from "./nodeKit";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { retypeInputCables } from "../fcReconcile";
import { processGraph } from "../process";

/** The list socket follows the op ([[type-propagation-on-in-place-socket-retype]]): a cable the new type refuses goes. */
async function applyAggregateOp(node: AggregateNodeType, op: ReduceOp): Promise<void> {
  node.setOp(op);
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  if (view) await view.rerenderNode(node.id);
  if (editor) await retypeInputCables(editor, view, node.id, "list");
  node.edited(); await processGraph();
}

// Record<ReduceOp, …> keeps this exhaustive: a new op fails the typecheck here.
const OP_GROUP: Record<ReduceOp, string> = {
  sum: "Basics", avg: "Basics", min: "Basics", max: "Basics", median: "Basics", product: "Basics",
  count: "Counts", countdistinct: "Counts", countblank: "Counts",
  geomean: "Other means", harmean: "Other means",
  stdev: "Spread", stdev_p: "Spread", var_s: "Spread", var_p: "Spread", sem: "Spread",
  cv: "Spread", ptp: "Spread", iqr: "Spread", mad: "Spread", avedev: "Spread", devsq: "Spread",
  skew: "Shape", skew_p: "Shape", kurt: "Shape",
  sumsq: "Squares", rms: "Squares",
};
const GROUP_ORDER = ["Basics", "Counts", "Other means", "Spread", "Shape", "Squares"];
const OPS = (Object.keys(REDUCE_OP_META) as ReduceOp[])
  .map((op) => ({ value: op, label: REDUCE_OP_META[op].label, title: REDUCE_OP_META[op].description, group: OP_GROUP[op] }))
  .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

export function AggregateComponent({ data, emit }: NodeProps<AggregateNodeType>) {
  const [op, setOpState] = useState<ReduceOp>(data.op);
  const setOp = (v: ReduceOp) => { setOpState(v); void applyAggregateOp(data, v); };
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
