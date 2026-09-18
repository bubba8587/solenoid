import type { IsCloseNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const IsCloseComponent = makeNodeComponent<IsCloseNode>((n) => n.cachedResult);
