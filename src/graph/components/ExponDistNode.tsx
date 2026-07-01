import { EXPON_DIST_OP_META } from "../nodes/dist-continuous";
import type { ExponDistNode as ExponDistNodeType, ExponDistOp } from "../nodes/dist-continuous";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(EXPON_DIST_OP_META) as ExponDistOp[]).map((op) => ({
  value: op,
  label: EXPON_DIST_OP_META[op].label,
}));

export function ExponDistComponent({ data, emit }: NodeProps<ExponDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
