import type { ComparisonNode as ComparisonNodeType, ComparisonOp } from "../rete-nodes";
import { COMPARISON_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

// Glyph first, then the name — the symbol is the faster read on the card.
const OPS = (Object.keys(COMPARISON_OP_META) as ComparisonOp[]).map((op) => ({
  value: op,
  label: `${COMPARISON_OP_META[op].symbol}  ${COMPARISON_OP_META[op].label}`,
}));

export function ComparisonComponent({ data, emit }: NodeProps<ComparisonNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      {/* cachedResult is a real logical — the isLogical branch renders TRUE/FALSE
          before any render override could run (the old 1/0 override was dead code). */}
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
