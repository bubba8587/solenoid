import type { StandardizeNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const StandardizeComponent = makeNodeComponent<StandardizeNode>((n) => n.cachedResult);
