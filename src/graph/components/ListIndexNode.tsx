import type { ListIndexNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ListIndexComponent = makeNodeComponent<ListIndexNode>((n) => n.cachedResult);
