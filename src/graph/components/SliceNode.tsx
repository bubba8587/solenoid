import type { SliceNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const SliceComponent = makeNodeComponent<SliceNode>((n) => n.cachedList);
