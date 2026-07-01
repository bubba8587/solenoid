import type { ProbNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ProbComponent = makeNodeComponent<ProbNode>((n) => n.cachedResult);
