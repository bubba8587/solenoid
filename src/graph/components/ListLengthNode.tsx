import type { ListLengthNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ListLengthComponent = makeNodeComponent<ListLengthNode>((n) => n.cachedResult);
