import type { ListIndexNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ListIndexComponent = makeNodeComponent<ListIndexNode>((n) => n.cachedResult);
