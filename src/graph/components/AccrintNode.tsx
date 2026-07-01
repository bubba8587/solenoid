import type { AccrintNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const AccrintComponent = makeNodeComponent<AccrintNode>((n) => n.cachedResult);
