import type { NormalizeNode, NormalizeMode } from "../rete-nodes";
import { makeToggleNodeComponent } from "./standardNode";

export const NormalizeComponent = makeToggleNodeComponent<NormalizeNode, NormalizeMode>(
  {
    read: (n) => n.mode,
    write: (n, m) => n.setMode(m),
    options: [
      { value: "minmax", label: "0–1", title: "Rescale to 0–1: min maps to 0, max to 1" },
      { value: "zscore", label: "z", title: "Z-scores: distance from the mean in standard deviations (numpy/R scale)" },
    ],
  },
  (n) => n.cachedList,
);
