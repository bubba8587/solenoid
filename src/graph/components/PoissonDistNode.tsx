import { POISSON_DIST_OP_META } from "../nodes/dist-discrete";
import type { PoissonDistNode as PoissonDistNodeType, PoissonDistOp } from "../nodes/dist-discrete";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(POISSON_DIST_OP_META) as PoissonDistOp[]).map((op) => ({
  value: op,
  label: POISSON_DIST_OP_META[op].label,
}));

export function PoissonDistComponent({ data, emit }: NodeProps<PoissonDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
