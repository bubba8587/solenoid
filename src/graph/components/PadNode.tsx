import type { PadNode as PadNodeType, PadDir } from "../rete-nodes";
import { PAD_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import type { DisplayValue } from "./valueDisplayFormat";

const DIRS: { value: PadDir; label: string }[] = (Object.keys(PAD_OP_META) as PadDir[]).map((d) => ({
  value: d,
  label: PAD_OP_META[d].label,
}));

export function PadComponent({ data, emit }: NodeProps<PadNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={DIRS} />
      <ValueDisplay value={data.cachedList as DisplayValue} />
    </NodeShell>
  );
}
