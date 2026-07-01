import type { ConcatNode } from "../rete-nodes";
import { makeExtensibleNodeComponent } from "./standardNode";

export const ConcatComponent = makeExtensibleNodeComponent<ConcatNode>((n) => n.cachedText);
