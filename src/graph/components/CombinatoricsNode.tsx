import { COMBINATORICS_OP_META } from "../rete-nodes";
import type { CombinatoricsNode as CombinatoricsNodeType, CombinatoricsOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(COMBINATORICS_OP_META) as CombinatoricsOp[]).map((op) => ({
  value: op,
  label: COMBINATORICS_OP_META[op].label,
}));

export function CombinatoricsComponent({ data, emit }: NodeProps<CombinatoricsNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
