import { F_INV_OP_META } from "../nodes/dist-continuous";
import type { FInvNode as FInvNodeType, FInvOp } from "../nodes/dist-continuous";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(F_INV_OP_META) as FInvOp[]).map((op) => ({
  value: op,
  label: F_INV_OP_META[op].label,
}));

export function FInvComponent({ data, emit }: NodeProps<FInvNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
