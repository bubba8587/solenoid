import type { PctChangeNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const PctChangeComponent = makeNodeComponent<PctChangeNode>((n) => n.cachedList);
