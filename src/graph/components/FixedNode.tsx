import { FIXED_NO_COMMAS_META } from "../rete-nodes";
import type { FixedNode as FixedNodeType, FixedNoCommas } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const NO_COMMAS_OPTS = (Object.keys(FIXED_NO_COMMAS_META) as FixedNoCommas[]).map((k) => ({
  value: k,
  label: FIXED_NO_COMMAS_META[k],
}));

export function FixedComponent({ data, emit }: NodeProps<FixedNodeType>) {
  const [noCommas, setNoCommas] = useNodeField(data, "noCommas");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={noCommas} onChange={setNoCommas} options={NO_COMMAS_OPTS} />
      <ValueDisplay value={data.cachedText} />
    </NodeShell>
  );
}
