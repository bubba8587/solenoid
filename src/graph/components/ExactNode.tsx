import type { ExactNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ExactComponent = makeNodeComponent<ExactNode>((n) => n.cachedResult);
