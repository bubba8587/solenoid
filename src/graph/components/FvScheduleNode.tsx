import type { FvScheduleNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const FvScheduleComponent = makeNodeComponent<FvScheduleNode>((n) => n.cachedResult);
