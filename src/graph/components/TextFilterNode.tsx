import type { TextFilterNode as TextFilterNodeType, TextFilterOp } from "../rete-nodes";
import { TEXT_FILTER_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(TEXT_FILTER_OP_META) as TextFilterOp[]).map(op => ({
  value: op, label: TEXT_FILTER_OP_META[op].label,
}));

export function TextFilterComponent({ data, emit }: NodeProps<TextFilterNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [, setLabel] = useNodeField(data, "label");
  function handleOp(next: TextFilterOp) {
    setOp(next);
    setLabel("Text Filter");
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <ValueDisplay value={data.cachedResult ?? null} />
    </NodeShell>
  );
}
