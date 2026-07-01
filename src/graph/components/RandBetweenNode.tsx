import type { RandBetweenNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const RandBetweenComponent = makeNodeComponent<RandBetweenNode>(
  (n) => n.cachedResult,
  { recalc: "Roll a new random value" },
);
