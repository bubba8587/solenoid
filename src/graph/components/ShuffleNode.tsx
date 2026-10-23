import type { ShuffleNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ShuffleComponent = makeNodeComponent<ShuffleNode>(
  (n) => n.cachedList,
  { recalc: "Shuffle again" },
);
