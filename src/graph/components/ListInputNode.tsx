import type { ListInputNode } from "../rete-nodes";
import { makeExtensibleNodeComponent } from "./standardNode";

export const ListInputComponent = makeExtensibleNodeComponent<ListInputNode>((n) => n.cachedList);
