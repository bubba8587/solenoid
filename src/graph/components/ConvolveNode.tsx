import type { ConvolveNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ConvolveComponent = makeNodeComponent<ConvolveNode>((n) => n.cachedList);
