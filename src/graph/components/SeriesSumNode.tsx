import type { SeriesSumNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const SeriesSumComponent = makeNodeComponent<SeriesSumNode>((n) => n.cachedResult);
