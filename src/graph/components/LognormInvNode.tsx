import type { LognormInvNode } from "../nodes/dist-continuous";
import { makeNodeComponent } from "./standardNode";

export const LognormInvComponent = makeNodeComponent<LognormInvNode>((n) => n.cachedResult);
