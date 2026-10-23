import type { ReverseNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const ReverseComponent = makeNodeComponent<ReverseNode>((n) => n.cachedList);
