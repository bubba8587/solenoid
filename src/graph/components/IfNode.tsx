import type { IfNode as IfNodeType } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const IfComponent = makeNodeComponent<IfNodeType>((n) => n.cachedResult);
