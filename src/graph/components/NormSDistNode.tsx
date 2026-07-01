import { NORM_S_DIST_OP_META } from "../nodes/dist-normal";
import type { NormSDistNode as NormSDistNodeType, NormSDistOp } from "../nodes/dist-normal";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(NORM_S_DIST_OP_META) as NormSDistOp[]).map((op) => ({
  value: op,
  label: NORM_S_DIST_OP_META[op].label,
}));

export function NormSDistComponent({ data, emit }: NodeProps<NormSDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
