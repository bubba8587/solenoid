import type { MirrNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const MirrComponent = makeNodeComponent<MirrNode>((n) => n.cachedResult);
