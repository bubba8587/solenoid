import type { TextAfterBeforeNode as TextAfterBeforeNodeType, TextAfterBeforeOp } from "../rete-nodes";
import { TEXT_AFTER_BEFORE_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(TEXT_AFTER_BEFORE_OP_META) as TextAfterBeforeOp[]).map(op => ({
  value: op,
  label: TEXT_AFTER_BEFORE_OP_META[op].label,
}));

export function TextAfterBeforeComponent({ data, emit }: NodeProps<TextAfterBeforeNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  function handleOp(next: TextAfterBeforeOp) {
    setOp(next);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedText} />
    </NodeShell>
  );
}
