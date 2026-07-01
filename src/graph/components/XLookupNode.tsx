import type { XLookupNode as XLookupNodeType, XLookupMatchMode, XLookupSearchMode } from "../rete-nodes";
import { XLOOKUP_MATCH_MODE_META, XLOOKUP_SEARCH_MODE_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const MATCH_MODES: { value: XLookupMatchMode; label: string }[] = (
  Object.keys(XLOOKUP_MATCH_MODE_META) as XLookupMatchMode[]
).map((m) => ({ value: m, label: XLOOKUP_MATCH_MODE_META[m] }));

const SEARCH_MODES: { value: XLookupSearchMode; label: string }[] = (
  Object.keys(XLOOKUP_SEARCH_MODE_META) as XLookupSearchMode[]
).map((s) => ({ value: s, label: XLOOKUP_SEARCH_MODE_META[s] }));

export function XLookupComponent({ data, emit }: NodeProps<XLookupNodeType>) {
  const [matchMode,  setMatchMode]  = useNodeField(data, "matchMode");
  const [searchMode, setSearchMode] = useNodeField(data, "searchMode");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={matchMode}  onChange={setMatchMode}  options={MATCH_MODES} />
      <OpSelect value={searchMode} onChange={setSearchMode} options={SEARCH_MODES} />
      <ValueDisplay value={data.cachedResult} empty="not found" />
    </NodeShell>
  );
}
