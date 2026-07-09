import type { ConcatListsNode as ConcatListsNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ConcatListsComponent = makeNodeComponent<ConcatListsNodeType>((n) => n.cachedList);
