import type { CrossNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const CrossComponent = makeNodeComponent<CrossNode>((n) => n.cachedList);
