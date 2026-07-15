import type { InterpolateNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const InterpolateComponent = makeNodeComponent<InterpolateNode>((n) => n.cachedResult);
