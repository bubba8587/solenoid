import type { StandardizeNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const StandardizeComponent = makeNodeComponent<StandardizeNode>((n) => n.cachedResult);
