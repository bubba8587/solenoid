// [[C17]] shareImpl, [[C51]] formulaNaming

import type { PackFormula } from "./packShared";

// TALLY returns only the counts, because the node's frame cannot cross the formula surface.
export const SETS_PACK_FORMULAS: PackFormula[] = [
  { name: "ISIN", arity: [2, 2], signature: "values, set — mask aligned to values" },
  { name: "TALLY", arity: [1, 1], signature: "values — counts per distinct value, first seen" },
];
