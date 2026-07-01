import { CONFIDENCE_OP_META } from "../rete-nodes";
import type { ConfidenceNode as ConfidenceNodeType, ConfidenceOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(CONFIDENCE_OP_META) as ConfidenceOp[]).map((op) => ({
  value: op,
  label: CONFIDENCE_OP_META[op].label,
}));

export function ConfidenceComponent({ data, emit }: NodeProps<ConfidenceNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
