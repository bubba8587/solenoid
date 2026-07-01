import type { UrlEncodeNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const UrlEncodeComponent = makeNodeComponent<UrlEncodeNode>((n) => n.cachedText);
