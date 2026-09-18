import type { TextLenNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const TextLenComponent = makeNodeComponent<TextLenNode>((n) => n.cachedResult);
