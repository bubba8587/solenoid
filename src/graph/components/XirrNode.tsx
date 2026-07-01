import type { XirrNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const XirrComponent = makeNodeComponent<XirrNode>((n) => n.cachedResult);
