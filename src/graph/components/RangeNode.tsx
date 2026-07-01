import type { RangeNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const RangeComponent = makeNodeComponent<RangeNode>((n) => n.cachedList);
