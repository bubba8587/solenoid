import type { BetweenNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const BetweenComponent = makeNodeComponent<BetweenNode>((n) => n.cachedResult);
