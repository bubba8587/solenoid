import { CORREL_OP_META } from "../rete-nodes";
import type { CorrelNode as CorrelNodeType, CorrelOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(CORREL_OP_META) as CorrelOp[]).map((op) => ({
  value: op,
  label: CORREL_OP_META[op].label,
}));

export function CorrelComponent({ data, emit }: NodeProps<CorrelNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
