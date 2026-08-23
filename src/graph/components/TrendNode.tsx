import type { TrendNode } from "../rete-nodes";
import { makeToggleNodeComponent } from "./standardNode";

export const TrendComponent = makeToggleNodeComponent<TrendNode, TrendNode["mode"]>(
  {
    read: (n) => n.mode,
    write: (n, m) => { n.mode = m; },
    options: [
      { value: "linear", label: "linear", title: "Linear fit — predict along a straight line (Excel TREND)" },
      { value: "exponential", label: "exp", title: "Exponential fit y = b·mˣ — predict along a growth curve (Excel GROWTH)" },
    ],
  },
  (n) => n.cachedList,
);
