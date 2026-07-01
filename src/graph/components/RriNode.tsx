import type { RriNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const RriComponent = makeNodeComponent<RriNode>((n) => n.cachedResult);
