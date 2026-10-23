import type { ListLengthNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ListLengthComponent = makeNodeComponent<ListLengthNode>((n) => n.cachedResult);
