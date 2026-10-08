import type { IfNode as IfNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const IfComponent = makeNodeComponent<IfNodeType>((n) => n.cachedResult);
