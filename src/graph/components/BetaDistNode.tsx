import { BETA_DIST_OP_META } from "../nodes/dist-continuous";
import type { BetaDistNode as BetaDistNodeType, BetaDistOp } from "../nodes/dist-continuous";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(BETA_DIST_OP_META) as BetaDistOp[]).map((op) => ({
  value: op,
  label: BETA_DIST_OP_META[op].label,
}));

export function BetaDistComponent({ data, emit }: NodeProps<BetaDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
