import { RUNNING_OP_META } from "../rete-nodes";
import type { RunningNode as RunningNodeType, RunningOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(RUNNING_OP_META) as RunningOp[]).map((op) => ({
  value: op, label: RUNNING_OP_META[op].label,
}));

export function RunningComponent({ data, emit }: NodeProps<RunningNodeType>) {
  const [agg, setAgg] = useNodeField(data, "agg");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={agg} onChange={setAgg} options={OPS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
