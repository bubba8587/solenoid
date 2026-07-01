import type { RandArrayNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const RandArrayComponent = makeNodeComponent<RandArrayNode>(
  (n) => n.cachedList,
  { recalc: "Roll new random values" },
);
