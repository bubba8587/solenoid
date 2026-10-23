import type { ConcatListsNode as ConcatListsNodeType } from "../nodeClasses";
import { makeExtensibleNodeComponent } from "./standardNode";

export const ConcatListsComponent = makeExtensibleNodeComponent<ConcatListsNodeType>((n) => n.cachedList);
