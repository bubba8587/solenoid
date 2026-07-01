import type { CovarianceNode as CovarianceNodeType, CovarianceOp } from "../rete-nodes";
import { COVARIANCE_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(COVARIANCE_OP_META) as CovarianceOp[]).map((op) => ({
  value: op,
  label: COVARIANCE_OP_META[op].label,
}));

export function CovarianceComponent({ data, emit }: NodeProps<CovarianceNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
