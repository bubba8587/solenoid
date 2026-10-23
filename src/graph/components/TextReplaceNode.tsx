import type { TextReplaceNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const TextReplaceComponent = makeNodeComponent<TextReplaceNode>((n) => n.cachedText);
