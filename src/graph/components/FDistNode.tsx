import { F_DIST_OP_META } from "../nodes/dist-continuous";
import type { FDistNode as FDistNodeType, FDistOp } from "../nodes/dist-continuous";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(F_DIST_OP_META) as FDistOp[]).map((op) => ({
  value: op,
  label: F_DIST_OP_META[op].label,
}));

export function FDistComponent({ data, emit }: NodeProps<FDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
