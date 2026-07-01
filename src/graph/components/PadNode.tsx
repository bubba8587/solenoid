import type { PadNode as PadNodeType, PadDir } from "../rete-nodes";
import { PAD_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const DIRS: { value: PadDir; label: string }[] = (Object.keys(PAD_OP_META) as PadDir[]).map((d) => ({
  value: d,
  label: PAD_OP_META[d].label,
}));

export function PadComponent({ data, emit }: NodeProps<PadNodeType>) {
  const [dir, setDir] = useNodeField(data, "dir");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={dir} onChange={setDir} options={DIRS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
