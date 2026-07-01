import { T_INV_OP_META } from "../nodes/dist-normal";
import type { TInvNode as TInvNodeType, TInvOp } from "../nodes/dist-normal";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(T_INV_OP_META) as TInvOp[]).map((op) => ({
  value: op,
  label: T_INV_OP_META[op].label,
}));

export function TInvComponent({ data, emit }: NodeProps<TInvNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
