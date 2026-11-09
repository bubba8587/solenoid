import type { IsCloseNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const IsCloseComponent = makeNodeComponent<IsCloseNode>((n) => n.cachedResult);
