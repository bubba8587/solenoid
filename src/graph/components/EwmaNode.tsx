import type { EwmaNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const EwmaComponent = makeNodeComponent<EwmaNode>((n) => n.cachedList);
