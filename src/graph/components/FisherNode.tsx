import type { FisherNode as FisherNodeType, FisherOp } from "../rete-nodes";
import { FISHER_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(FISHER_OP_META) as FisherOp[]).map((op) => ({
  value: op,
  label: FISHER_OP_META[op].label,
}));

export function FisherComponent({ data, emit }: NodeProps<FisherNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
