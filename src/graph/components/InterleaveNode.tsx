import type { InterleaveNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const InterleaveComponent = makeNodeComponent<InterleaveNode>((n) => n.cachedList);
