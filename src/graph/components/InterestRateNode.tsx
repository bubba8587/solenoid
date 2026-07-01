import type { InterestRateNode as InterestRateNodeType, InterestRateOp } from "../rete-nodes";
import { INTEREST_RATE_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(INTEREST_RATE_OP_META) as InterestRateOp[]).map((op) => ({
  value: op,
  label: INTEREST_RATE_OP_META[op].label,
}));

export function InterestRateComponent({ data, emit }: NodeProps<InterestRateNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
