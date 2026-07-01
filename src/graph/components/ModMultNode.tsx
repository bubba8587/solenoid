import type { ModMultNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ModMultComponent = makeNodeComponent<ModMultNode>((n) => n.cachedList);
