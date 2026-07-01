import { GAMMA_DIST_OP_META } from "../nodes/dist-continuous";
import type { GammaDistNode as GammaDistNodeType, GammaDistOp } from "../nodes/dist-continuous";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(GAMMA_DIST_OP_META) as GammaDistOp[]).map((op) => ({
  value: op,
  label: GAMMA_DIST_OP_META[op].label,
}));

export function GammaDistComponent({ data, emit }: NodeProps<GammaDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
