import type { ClampNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ClampComponent = makeNodeComponent<ClampNode>((n) => n.cachedResult);
