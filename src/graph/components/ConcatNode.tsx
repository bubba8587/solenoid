import type { ConcatNode } from "../nodeClasses";
import { makeExtensibleNodeComponent } from "./standardNode";

export const ConcatComponent = makeExtensibleNodeComponent<ConcatNode>((n) => n.cachedText);
