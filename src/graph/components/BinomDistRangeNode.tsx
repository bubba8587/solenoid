import type { BinomDistRangeNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const BinomDistRangeComponent = makeNodeComponent<BinomDistRangeNode>((n) => n.cachedResult);
