import type { ForecastNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ForecastComponent = makeNodeComponent<ForecastNode>((n) => n.cachedResult);
