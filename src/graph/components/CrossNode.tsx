import type { CrossNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const CrossComponent = makeNodeComponent<CrossNode>((n) => n.cachedList);
