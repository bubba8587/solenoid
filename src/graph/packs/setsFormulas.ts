// [[D19]] implReteFree, [[C17]] shareImpl, [[C51]] formulaNaming

import { isInMask, tallyPairs } from "../nodes/listOps";
import type { PackFormula } from "./packShared";

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

// TALLY returns only the counts, because the node's frame cannot cross the formula surface.
export const SETS_PACK_FORMULAS: PackFormula[] = [
  {
    name: "ISIN",
    impl: (a, b) => isInMask(asList(a), asList(b)),
    returns: "logical", rank: "list", listArgs: true, arity: [2, 2],
    signature: "values, set — mask aligned to values",
  },
  {
    name: "TALLY",
    impl: (v) => tallyPairs(asList(v)).counts,
    returns: "number", rank: "list", listArgs: true, arity: [1, 1],
    signature: "values — counts per distinct value, first seen",
  },
];
