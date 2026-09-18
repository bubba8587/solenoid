import type { SubstituteNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const SubstituteComponent = makeNodeComponent<SubstituteNode>((n) => n.cachedText);
