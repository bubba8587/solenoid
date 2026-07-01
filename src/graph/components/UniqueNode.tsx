import type { UniqueNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const UniqueComponent = makeNodeComponent<UniqueNode>((n) => n.cachedList);
