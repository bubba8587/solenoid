import type { RoundNNode as RoundNNodeType, RoundNOp } from "../rete-nodes";
import { ROUNDN_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(ROUNDN_OP_META) as RoundNOp[]).map((op) => ({
  value: op,
  label: ROUNDN_OP_META[op].label,
}));

export function RoundNComponent({ data, emit }: NodeProps<RoundNNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
