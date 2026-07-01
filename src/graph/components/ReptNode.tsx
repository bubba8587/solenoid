import type { ReptNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ReptComponent = makeNodeComponent<ReptNode>((n) => n.cachedText);
