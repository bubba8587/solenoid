import type { FvScheduleNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const FvScheduleComponent = makeNodeComponent<FvScheduleNode>((n) => n.cachedResult);
