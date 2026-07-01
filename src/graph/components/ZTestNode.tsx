import type { ZTestNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ZTestComponent = makeNodeComponent<ZTestNode>((n) => n.cachedResult);
