import type { NormalizeNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const NormalizeComponent = makeNodeComponent<NormalizeNode>((n) => n.cachedList);
