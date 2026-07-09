// Set & Relational — the pack scoped in backlog.md (author 2026-07-07). The
// core Set / Set Relation nodes stay core; this pack adds the two list-level
// companions (Is In membership mask, Tally value counts) and claims the new
// COUNT DISTINCT aggregate op. Its table-level siblings — the semi/anti join
// modes — ship as core Join `how` options (an op of a core node can't be
// pack-gated), landed alongside this pack.

import { IsInNode, TallyNode } from "../rete-nodes";
import type { Pack } from "./packShared";

export const SETS_PACK: Pack = {
  id: "sets",
  name: "Sets & Membership",
  description: "List membership and counting: Is In (per-element membership mask — the ISNUMBER(MATCH()) idiom), Tally (value counts as a table), and the COUNT DISTINCT aggregate. The Join node's semi/anti modes are the table-level counterparts.",
  builtin: true,
  defaultActive: false,
  nodes: [
    {
      path: ["Lists", "Find"],
      entry: {
        type: "sets-isin",
        label: "Is In",
        description: "For each item of Values: TRUE if it appears in Set — a logical mask aligned to Values, ready for Filter. In Excel you'd write =ISNUMBER(MATCH(A1,list,0)).",
        keywords: "membership contains mask in list isnumber match",
        create: () => new IsInNode(),
      },
    },
    {
      path: ["Lists", "Aggregate"],
      entry: {
        type: "sets-tally",
        label: "Tally",
        description: "Distinct value → occurrence count, as a two-column table (first-seen order). The bare-list shortcut for a one-column pivot / GROUPBY count.",
        keywords: "value counts frequency histogram group count occurrences",
        create: () => new TallyNode(),
      },
    },
  ],
  // The new core aggregate op is claimed by this pack (hidden with it).
  tags: ["reduce-countdistinct"],
};
