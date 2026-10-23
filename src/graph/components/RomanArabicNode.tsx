import type { RomanArabicNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const RomanArabicComponent = makeNodeComponent<RomanArabicNode>((n) => n.cachedResult);
