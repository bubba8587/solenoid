import type { SliceNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const SliceComponent = makeNodeComponent<SliceNode>((n) => n.cachedList);
