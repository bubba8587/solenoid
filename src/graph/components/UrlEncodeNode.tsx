import type { UrlEncodeNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const UrlEncodeComponent = makeNodeComponent<UrlEncodeNode>((n) => n.cachedText);
