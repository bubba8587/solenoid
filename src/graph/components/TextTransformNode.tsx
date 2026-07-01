import type { TextTransformNode as TextTransformNodeType, TextTransformOp } from "../rete-nodes";
import { TEXT_TRANSFORM_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(TEXT_TRANSFORM_OP_META) as TextTransformOp[]).map((op) => ({
  value: op,
  label: TEXT_TRANSFORM_OP_META[op].label,
}));

export function TextTransformComponent({ data, emit }: NodeProps<TextTransformNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedText} />
    </NodeShell>
  );
}
