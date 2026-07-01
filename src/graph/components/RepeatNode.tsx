import type { RepeatNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const RepeatComponent = makeNodeComponent<RepeatNode>((n) => n.cachedList);
