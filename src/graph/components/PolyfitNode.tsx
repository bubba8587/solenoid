import type { PolyfitNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const PolyfitComponent = makeNodeComponent<PolyfitNode>((n) => n.cachedList);
