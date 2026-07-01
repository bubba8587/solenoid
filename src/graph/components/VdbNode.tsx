import type { VdbNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const VdbComponent = makeNodeComponent<VdbNode>((n) => n.cachedResult);
