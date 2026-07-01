import type { XnpvNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const XnpvComponent = makeNodeComponent<XnpvNode>((n) => n.cachedResult);
