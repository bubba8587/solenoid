import type { ShuffleNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ShuffleComponent = makeNodeComponent<ShuffleNode>(
  (n) => n.cachedList,
  { recalc: "Shuffle again" },
);
