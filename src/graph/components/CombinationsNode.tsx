import type { CombinationsNode } from "../rete-nodes";
import { makeToggleNodeComponent } from "./standardNode";

export const CombinationsComponent = makeToggleNodeComponent<CombinationsNode, CombinationsNode["mode"]>(
  {
    read: (n) => n.mode,
    write: (n, m) => { n.mode = m; },
    options: [
      { value: "combinations", label: "combos", title: "Order-independent subsets (itertools.combinations)" },
      { value: "permutations", label: "perms", title: "Ordered arrangements (itertools.permutations)" },
    ],
  },
  (n) => n.cachedResult,
  { table: true },
);
