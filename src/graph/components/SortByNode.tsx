import type { SortByNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const SortByComponent = makeNodeComponent<SortByNode>((n) => n.cachedList);
