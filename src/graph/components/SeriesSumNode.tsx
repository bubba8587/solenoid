import type { SeriesSumNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const SeriesSumComponent = makeNodeComponent<SeriesSumNode>((n) => n.cachedResult);
