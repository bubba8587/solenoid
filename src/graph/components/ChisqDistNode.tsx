import { CHISQ_DIST_OP_META } from "../nodes/dist-normal";
import type { ChisqDistNode as ChisqDistNodeType, ChisqDistOp } from "../nodes/dist-normal";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(CHISQ_DIST_OP_META) as ChisqDistOp[]).map((op) => ({
  value: op,
  label: CHISQ_DIST_OP_META[op].label,
}));

export function ChisqDistComponent({ data, emit }: NodeProps<ChisqDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
