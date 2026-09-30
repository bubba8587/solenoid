import { COMPARISON_OP_META, type ComparisonOp, type ComparisonNode as ComparisonNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

// Glyph first: the symbol is the faster read on the card.
const OPS = Object.fromEntries(
  (Object.keys(COMPARISON_OP_META) as ComparisonOp[]).map((op) => [op, { label: `${COMPARISON_OP_META[op].symbol}  ${COMPARISON_OP_META[op].label}` }]),
) as Record<ComparisonOp, { label: string }>;

export const ComparisonComponent = makeOpNodeComponent<ComparisonOp, ComparisonNodeType>(OPS, (n) => n.cachedResult);
