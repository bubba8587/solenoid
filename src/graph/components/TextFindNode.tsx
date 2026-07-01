import type { TextFindNode as TextFindNodeType, TextFindOp } from "../rete-nodes";
import { TEXT_FIND_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(TEXT_FIND_OP_META) as TextFindOp[]).map((op) => ({
  value: op,
  label: TEXT_FIND_OP_META[op].label,
}));

export function TextFindComponent({ data, emit }: NodeProps<TextFindNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
