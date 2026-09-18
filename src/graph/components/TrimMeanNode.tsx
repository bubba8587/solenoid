import type { TrimMeanNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const TrimMeanComponent = makeNodeComponent<TrimMeanNode>((n) => n.cachedResult);
