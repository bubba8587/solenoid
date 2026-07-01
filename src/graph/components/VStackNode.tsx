import type { VStackNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const VStackComponent = makeNodeComponent<VStackNode>((n) => n.cachedList);
