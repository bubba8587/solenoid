import type { IspmtNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const IspmtComponent = makeNodeComponent<IspmtNode>((n) => n.cachedResult);
