import type { NthElementNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const NthElementComponent = makeNodeComponent<NthElementNode>((n) => n.cachedList);
