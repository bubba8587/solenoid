import type { HypotenuseNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const HypotenuseComponent = makeNodeComponent<HypotenuseNode>((n) => n.cachedResult);
