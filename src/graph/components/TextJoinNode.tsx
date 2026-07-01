import { TEXTJOIN_IGNORE_EMPTY_META } from "../rete-nodes";
import type { TextJoinNode as TextJoinNodeType, TextJoinIgnoreEmpty } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const IGNORE_EMPTY_OPTS = (Object.keys(TEXTJOIN_IGNORE_EMPTY_META) as TextJoinIgnoreEmpty[]).map((k) => ({
  value: k,
  label: TEXTJOIN_IGNORE_EMPTY_META[k],
}));

export function TextJoinComponent({ data, emit }: NodeProps<TextJoinNodeType>) {
  const [ignoreEmpty, setIgnoreEmpty] = useNodeField(data, "ignoreEmpty");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={ignoreEmpty} onChange={setIgnoreEmpty} options={IGNORE_EMPTY_OPTS} />
      <ValueDisplay value={data.cachedText} />
    </NodeShell>
  );
}
