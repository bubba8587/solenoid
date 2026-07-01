import { NTH_VALUE_OP_META } from "../rete-nodes";
import type { NthValueNode as NthValueNodeType, NthValueOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(NTH_VALUE_OP_META) as NthValueOp[]).map((op) => ({
  value: op,
  label: NTH_VALUE_OP_META[op].label,
}));

export function NthValueComponent({ data, emit }: NodeProps<NthValueNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
