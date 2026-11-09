import type { IspmtNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const IspmtComponent = makeNodeComponent<IspmtNode>((n) => n.cachedResult);
