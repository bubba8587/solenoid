import type { BetaInvNode } from "../nodes/dist-continuous";
import { makeNodeComponent } from "./standardNode";

export const BetaInvComponent = makeNodeComponent<BetaInvNode>((n) => n.cachedResult);
