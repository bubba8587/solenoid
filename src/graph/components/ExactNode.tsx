import type { ExactNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ExactComponent = makeNodeComponent<ExactNode>((n) => n.cachedResult);
