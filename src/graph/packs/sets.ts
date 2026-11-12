// [[C51]] formulaNaming, [[formula-language#The Comparison card's ops are functions; the card is core, Sets, Between, Is In and Tally the Sets pack]]
import { BetweenNode, IsInNode, SetsNode, TallyNode } from "../nodeClasses";
import type { Pack } from "./packShared";
import { SETS_PACK_FORMULAS } from "./setsFormulas";

const PATH = ["Packs", "Sets & Comparisons"];

export const SETS_PACK: Pack = {
  formulas: SETS_PACK_FORMULAS,
  id: "sets",
  seed: "pack-sets",
  group: "Everyday",
  name: "Sets & Comparisons",
  description: "Tests and set operations on lists: the comparison functions (IS, ABOVE and the rest), Between, Sets, Is In (the ISNUMBER(MATCH()) idiom), Tally (value counts) and COUNT DISTINCT. Join's semi and anti modes cover tables.",
  builtin: true,
  defaultActive: true,
  nodes: [
    {
      path: PATH,
      entry: {
        type: "between", updated: "1.6",
        label: "Between",
        description: "`TRUE` when Low ≤ Value ≤ High (inclusive). R `between` / pandas `Series.between`. Formula: `BETWEEN`.",
        parity: false,
        keywords: "between range within inclusive bounds interval clamp test low high",
        create: () => new BetweenNode(),
      },
    },
    {
      path: PATH,
      entry: {
        type: "list-sets",
        label: "Sets",
        description: "Set operations on two lists: union, intersection, difference, symmetric difference; the relations equal, subset, superset, disjoint give `TRUE` or `FALSE`. Excel builds these from `COUNTIF`.",
        parity: false,
        keywords: "set union intersect intersection difference except minus complement symmetric relation equal same identical subset superset disjoint overlap contains all within compare two lists distinct dedupe subtract exclude common membership issubset issuperset predicate test boolean",
        create: () => new SetsNode(),
      },
    },
    {
      path: PATH,
      entry: {
        type: "sets-isin",
        label: "Is In",
        description: "For each item of Values: TRUE if it appears in Set, a logical mask aligned to Values, ready for Filter. Excel: ISNUMBER(MATCH(A1, list, 0)).",
        keywords: "membership contains mask in list isnumber match",
        create: () => new IsInNode(),
      },
    },
    {
      path: PATH,
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
