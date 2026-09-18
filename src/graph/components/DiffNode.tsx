import type { DiffNode, DiffMode } from "../rete-nodes";
import { makeToggleNodeComponent } from "./standardNode";

export const DiffComponent = makeToggleNodeComponent<DiffNode, DiffMode>(
  {
    read: (n) => n.mode,
    write: (n, m) => n.setMode(m),
    options: [
      { value: "delta", label: "Δ", title: "Absolute difference: list[i] − list[i−1]" },
      { value: "percent", label: "%", title: "Percent change: (list[i] − list[i−1]) / list[i−1] (pandas pct_change)" },
      { value: "gradient", label: "∇", title: "Gradient: central-difference slope at each point, same length as the input (numpy.gradient)" },
    ],
  },
  (n) => n.cachedList,
);
