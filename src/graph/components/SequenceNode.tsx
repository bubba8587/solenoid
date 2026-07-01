import type { SequenceNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const SequenceComponent = makeNodeComponent<SequenceNode>((n) => n.cachedList);
