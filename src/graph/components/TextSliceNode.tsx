import type { TextSliceNode as TextSliceNodeType, TextSliceOp } from "../rete-nodes";
import { TEXT_SLICE_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(TEXT_SLICE_OP_META) as TextSliceOp[]).map((op) => ({
  value: op,
  label: TEXT_SLICE_OP_META[op].label,
}));

export function TextSliceComponent({ data, emit }: NodeProps<TextSliceNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedText} />
    </NodeShell>
  );
}
