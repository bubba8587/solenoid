import type { TrimMeanNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const TrimMeanComponent = makeNodeComponent<TrimMeanNode>((n) => n.cachedResult);
