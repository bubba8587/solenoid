import type { TextSplitNode as TextSplitNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const TextSplitComponent = makeNodeComponent<TextSplitNodeType>((n) => n.cachedResult ?? null);
