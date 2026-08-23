import type { BetweenNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const BetweenComponent = makeNodeComponent<BetweenNode>((n) => n.cachedResult);
