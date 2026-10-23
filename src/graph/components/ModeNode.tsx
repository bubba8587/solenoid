import type { ModeNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ModeComponent = makeNodeComponent<ModeNode>((n) => n.cachedResult);
