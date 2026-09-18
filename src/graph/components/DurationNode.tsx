import type { DurationNode as DurationNodeType, DurationOp } from "../rete-nodes";
import { DURATION_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(DURATION_OP_META) as DurationOp[]).map(op => ({
  value: op, label: DURATION_OP_META[op].label,
}));

export function DurationComponent({ data, emit }: NodeProps<DurationNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: DurationOp) { setOp(next); setLabel(DURATION_OP_META[next].label); }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
