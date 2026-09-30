import type { ConcatListsNode as ConcatListsNodeType } from "../rete-nodes";
import { makeExtensibleNodeComponent } from "./standardNode";

export const ConcatListsComponent = makeExtensibleNodeComponent<ConcatListsNodeType>((n) => n.cachedList);
