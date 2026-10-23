import type { TrapzNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const TrapzComponent = makeNodeComponent<TrapzNode>((n) => n.cachedResult);
