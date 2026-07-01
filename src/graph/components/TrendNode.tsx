import type { TrendNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const TrendComponent = makeNodeComponent<TrendNode>((n) => n.cachedList);
