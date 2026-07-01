import type { FTestNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const FTestComponent = makeNodeComponent<FTestNode>((n) => n.cachedResult);
