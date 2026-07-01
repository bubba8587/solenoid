import type { BinomDistRangeNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const BinomDistRangeComponent = makeNodeComponent<BinomDistRangeNode>((n) => n.cachedResult);
