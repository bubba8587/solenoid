import type { TextLenNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const TextLenComponent = makeNodeComponent<TextLenNode>((n) => n.cachedResult);
