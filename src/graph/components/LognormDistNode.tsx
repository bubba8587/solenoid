import { LOGNORM_DIST_OP_META } from "../nodes/dist-continuous";
import type { LognormDistNode as LognormDistNodeType, LognormDistOp } from "../nodes/dist-continuous";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(LOGNORM_DIST_OP_META) as LognormDistOp[]).map((op) => ({
  value: op,
  label: LOGNORM_DIST_OP_META[op].label,
}));

export function LognormDistComponent({ data, emit }: NodeProps<LognormDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
