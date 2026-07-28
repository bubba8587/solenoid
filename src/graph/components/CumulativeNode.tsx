import type { CumulativeNode as CumulativeNodeType, CumulativeOp } from "../rete-nodes";
import { CUMULATIVE_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(CUMULATIVE_OP_META) as CumulativeOp[]).map((op) => ({
  value: op,
  label: CUMULATIVE_OP_META[op].label,
}));

export function CumulativeComponent({ data, emit }: NodeProps<CumulativeNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
