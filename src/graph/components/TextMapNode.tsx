import type { TextMapNode as TextMapNodeType, TextTransformOp } from "../rete-nodes";
import { TEXT_TRANSFORM_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(TEXT_TRANSFORM_OP_META) as TextTransformOp[]).map(op => ({
  value: op,
  label: TEXT_TRANSFORM_OP_META[op].label,
}));

export function TextMapComponent({ data, emit }: NodeProps<TextMapNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: TextTransformOp) {
    setOp(next);
    setLabel(`${TEXT_TRANSFORM_OP_META[next].label} (list)`);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedResult ?? null} />
    </NodeShell>
  );
}
