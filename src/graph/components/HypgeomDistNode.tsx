import { HYPGEOM_DIST_OP_META } from "../nodes/dist-discrete";
import type { HypgeomDistNode as HypgeomDistNodeType, HypgeomDistOp } from "../nodes/dist-discrete";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(HYPGEOM_DIST_OP_META) as HypgeomDistOp[]).map((op) => ({
  value: op,
  label: HYPGEOM_DIST_OP_META[op].label,
}));

export function HypgeomDistComponent({ data, emit }: NodeProps<HypgeomDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
