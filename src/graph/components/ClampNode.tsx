import type { ClampNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ClampComponent = makeNodeComponent<ClampNode>((n) => n.cachedResult);
