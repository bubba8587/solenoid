import type { ProbNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ProbComponent = makeNodeComponent<ProbNode>((n) => n.cachedResult);
