import type { ConvolveNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ConvolveComponent = makeNodeComponent<ConvolveNode>((n) => n.cachedList);
