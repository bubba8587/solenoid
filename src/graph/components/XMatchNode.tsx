import type { XMatchNode as XMatchNodeType, XMatchMatchMode, XMatchSearchMode } from "../nodeClasses";
import { XMATCH_MATCH_MODE_META, XMATCH_SEARCH_MODE_META } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { CardSection } from "./CardSection";

const MATCH_MODES: { value: XMatchMatchMode; label: string }[] = (
  Object.keys(XMATCH_MATCH_MODE_META) as XMatchMatchMode[]
).map((m) => ({ value: m, label: XMATCH_MATCH_MODE_META[m] }));

// The same control the frame XLOOKUP carries for the same argument.
const SEARCH_MODES: { value: XMatchSearchMode; label: string; title: string }[] = (
  Object.keys(XMATCH_SEARCH_MODE_META) as XMatchSearchMode[]
).map((m) => ({ value: m, ...XMATCH_SEARCH_MODE_META[m] }));

export function XMatchComponent({ data, emit }: NodeProps<XMatchNodeType>) {
  const [matchMode, setMatchMode] = useNodeField(data, "matchMode");
  const [searchMode, setSearchMode] = useNodeField(data, "searchMode");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={matchMode} onChange={setMatchMode} options={MATCH_MODES} />
      {/* XLOOKUP's Options hold the same argument. */}
      <CardSection label="Options" collapsible defaultOpen={searchMode !== "first"}>
        <SegToggle value={searchMode} options={SEARCH_MODES} onChange={setSearchMode} />
      </CardSection>
      <ValueDisplay value={data.cachedResult} empty="not found" />
    </NodeShell>
  );
}
