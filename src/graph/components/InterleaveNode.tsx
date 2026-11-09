import type { InterleaveNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const InterleaveComponent = makeNodeComponent<InterleaveNode>((n) => n.cachedList);
