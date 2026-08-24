import type { AggregateNode as AggregateNodeType, ReduceOp } from "../rete-nodes";
import { REDUCE_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

// Record<ReduceOp, …> keeps this exhaustive: a new op fails the typecheck here.
const OP_GROUP: Record<ReduceOp, string> = {
  sum: "Basics", avg: "Basics", min: "Basics", max: "Basics", median: "Basics", product: "Basics",
  first: "Basics", last: "Basics",
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
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
