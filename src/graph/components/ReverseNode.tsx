import type { ReverseNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ReverseComponent = makeNodeComponent<ReverseNode>((n) => n.cachedList);
