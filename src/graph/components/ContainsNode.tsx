import type { ContainsNode as ContainsNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ContainsComponent = makeNodeComponent<ContainsNodeType>((n) => n.cachedResult);
