import { NORM_DIST_OP_META } from "../nodes/dist-normal";
import type { NormDistNode as NormDistNodeType, NormDistOp } from "../nodes/dist-normal";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(NORM_DIST_OP_META) as NormDistOp[]).map((op) => ({
  value: op,
  label: NORM_DIST_OP_META[op].label,
}));

export function NormDistComponent({ data, emit }: NodeProps<NormDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
