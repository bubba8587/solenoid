import { ROLLING_OP_META } from "../rete-nodes";
import type { RollingNode as RollingNodeType, RollingOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(ROLLING_OP_META) as RollingOp[]).map((op) => ({
  value: op, label: ROLLING_OP_META[op].label,
}));

export function RollingComponent({ data, emit }: NodeProps<RollingNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
