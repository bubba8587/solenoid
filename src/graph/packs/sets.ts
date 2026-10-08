// [[C51]] formulaNaming
import { IsInNode, TallyNode } from "../rete-nodes";
import type { Pack } from "./packShared";
import { SETS_PACK_FORMULAS } from "./setsFormulas";

export const SETS_PACK: Pack = {
  formulas: SETS_PACK_FORMULAS,
  id: "sets",
  group: "Everyday",
  name: "Sets & Membership",
  description: "List membership and counting: Is In (the ISNUMBER(MATCH()) idiom), Tally (value counts) and COUNT DISTINCT. Join's semi and anti modes cover tables.",
  builtin: true,
  defaultActive: false,
  nodes: [
    {
      path: ["Packs", "Sets & Membership"],
      entry: {
        type: "sets-isin",
        label: "Is In",
        description: "For each item of Values: TRUE if it appears in Set, a logical mask aligned to Values, ready for Filter. Excel: ISNUMBER(MATCH(A1, list, 0)).",
        keywords: "membership contains mask in list isnumber match",
        create: () => new IsInNode(),
      },
    },
    {
      path: ["Packs", "Sets & Membership"],
      entry: {
        type: "sets-tally",
        label: "Tally",
        description: "Distinct value → occurrence count, as a two-column table (first-seen order). The bare-list shortcut for a one-column pivot or GROUPBY count.",
        keywords: "value counts frequency histogram group count occurrences",
        create: () => new TallyNode(),
      },
    },
  ],
  tags: ["reduce-countdistinct"],
};
