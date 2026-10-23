import type { UuidNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const UuidComponent = makeNodeComponent<UuidNode>((n) => n.cachedText, { recalc: "New UUID (F9)" });
