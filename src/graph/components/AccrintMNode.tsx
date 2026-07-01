import type { AccrintMNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const AccrintMComponent = makeNodeComponent<AccrintMNode>((n) => n.cachedResult);
