import type { MRoundNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const MRoundComponent = makeNodeComponent<MRoundNode>((n) => n.cachedResult);
