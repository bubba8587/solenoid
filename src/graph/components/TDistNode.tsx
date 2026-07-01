import { T_DIST_OP_META } from "../nodes/dist-normal";
import type { TDistNode as TDistNodeType, TDistOp } from "../nodes/dist-normal";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(T_DIST_OP_META) as TDistOp[]).map((op) => ({
  value: op,
  label: T_DIST_OP_META[op].label,
}));

export function TDistComponent({ data, emit }: NodeProps<TDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
