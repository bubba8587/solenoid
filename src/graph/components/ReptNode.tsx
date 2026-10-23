import type { ReptNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ReptComponent = makeNodeComponent<ReptNode>((n) => n.cachedText);
