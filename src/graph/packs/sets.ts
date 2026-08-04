import { IsInNode, TallyNode, isInMask, tallyPairs } from "../rete-nodes";
import type { Pack, PackFormula } from "./packShared";

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

// The pack's nodes as formula functions (D19 decision 4); TALLY returns only the
// COUNTS, since the node's frame can't cross the formula surface.
const SETS_PACK_FORMULAS: PackFormula[] = [
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

export const SETS_PACK: Pack = {
  formulas: SETS_PACK_FORMULAS,
  id: "sets",
  name: "Sets & Membership",
  description: "List membership and counting: Is In (per-element membership mask — the ISNUMBER(MATCH()) idiom), Tally (value counts as a table), and the COUNT DISTINCT aggregate. The Join node's semi/anti modes are the table-level counterparts.",
  builtin: true,
  defaultActive: false,
  nodes: [
    {
      path: ["Packs", "Sets & Membership"],
      entry: {
        type: "sets-isin",
        label: "Is In",
        description: "For each item of Values: TRUE if it appears in Set — a logical mask aligned to Values, ready for Filter. In Excel you'd write =ISNUMBER(MATCH(A1,list,0)).",
        keywords: "membership contains mask in list isnumber match",
        create: () => new IsInNode(),
      },
    },
    {
      path: ["Packs", "Sets & Membership"],
      entry: {
        type: "sets-tally",
        label: "Tally",
        description: "Distinct value → occurrence count, as a two-column table (first-seen order). The bare-list shortcut for a one-column pivot / GROUPBY count.",
        keywords: "value counts frequency histogram group count occurrences",
        create: () => new TallyNode(),
      },
    },
  ],
  tags: ["reduce-countdistinct"],
};
