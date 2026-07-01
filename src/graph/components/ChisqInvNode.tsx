import { CHISQ_INV_OP_META } from "../nodes/dist-normal";
import type { ChisqInvNode as ChisqInvNodeType, ChisqInvOp } from "../nodes/dist-normal";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(CHISQ_INV_OP_META) as ChisqInvOp[]).map((op) => ({
  value: op,
  label: CHISQ_INV_OP_META[op].label,
}));

export function ChisqInvComponent({ data, emit }: NodeProps<ChisqInvNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
