import type { SetOpNode as SetOpNodeType, SetOp } from "../rete-nodes";
import { SET_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(SET_OP_META) as SetOp[]).map((op) => ({
  value: op,
  label: SET_OP_META[op].label,
}));

export function SetOpComponent({ data, emit }: NodeProps<SetOpNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
