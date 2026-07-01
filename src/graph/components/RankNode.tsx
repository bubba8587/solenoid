import { RANK_OP_META } from "../rete-nodes";
import type { RankNode as RankNodeType, RankOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(RANK_OP_META) as RankOp[]).map((op) => ({
  value: op,
  label: RANK_OP_META[op].label,
}));

export function RankComponent({ data, emit }: NodeProps<RankNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
