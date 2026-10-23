import type { ContainsNode as ContainsNodeType } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ContainsComponent = makeNodeComponent<ContainsNodeType>((n) => n.cachedResult);
