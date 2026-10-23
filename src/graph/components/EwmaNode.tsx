import type { EwmaNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const EwmaComponent = makeNodeComponent<EwmaNode>((n) => n.cachedList);
