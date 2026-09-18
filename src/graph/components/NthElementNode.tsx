import type { NthElementNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const NthElementComponent = makeNodeComponent<NthElementNode>((n) => n.cachedList);
