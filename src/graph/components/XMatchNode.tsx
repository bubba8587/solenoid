import type { XMatchNode as XMatchNodeType, XMatchMatchMode } from "../rete-nodes";
import { XMATCH_MATCH_MODE_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const MATCH_MODES: { value: XMatchMatchMode; label: string }[] = (
  Object.keys(XMATCH_MATCH_MODE_META) as XMatchMatchMode[]
).map((m) => ({ value: m, label: XMATCH_MATCH_MODE_META[m] }));

export function XMatchComponent({ data, emit }: NodeProps<XMatchNodeType>) {
  const [matchMode, setMatchMode] = useNodeField(data, "matchMode");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={matchMode} onChange={setMatchMode} options={MATCH_MODES} />
      <ValueDisplay value={data.cachedResult} empty="not found" />
    </NodeShell>
  );
}
