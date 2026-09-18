import type { TrapzNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const TrapzComponent = makeNodeComponent<TrapzNode>((n) => n.cachedResult);
