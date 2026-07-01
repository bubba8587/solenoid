import type { PdurationNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const PdurationComponent = makeNodeComponent<PdurationNode>((n) => n.cachedResult);
