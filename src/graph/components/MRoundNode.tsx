import type { MRoundNode, MRoundOp } from "../rete-nodes";
import { MROUND_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(MROUND_OP_META) as MRoundOp[]).map((op) => ({
  value: op,
  label: MROUND_OP_META[op].label,
}));

export function MRoundComponent({ data, emit }: NodeProps<MRoundNode>) {
  const [op, setOp] = useNodeField(data, "op");
  // Set the label BEFORE setOp, so the re-render setOp triggers shows the new title.
  const changeOp = (v: MRoundOp) => {
    data.label = MROUND_OP_META[v].label;
    setOp(v);
  };
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={changeOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
