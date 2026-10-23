import type { PolyfitNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const PolyfitComponent = makeNodeComponent<PolyfitNode>((n) => n.cachedList);
