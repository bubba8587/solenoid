import type { RomanArabicNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const RomanArabicComponent = makeNodeComponent<RomanArabicNode>((n) => n.cachedResult);
