import type { SubstituteNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const SubstituteComponent = makeNodeComponent<SubstituteNode>((n) => n.cachedText);
