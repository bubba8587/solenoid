import type { ChisqTestNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ChisqTestComponent = makeNodeComponent<ChisqTestNode>((n) => n.cachedResult);
