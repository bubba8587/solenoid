import type { TextReplaceNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const TextReplaceComponent = makeNodeComponent<TextReplaceNode>((n) => n.cachedText);
