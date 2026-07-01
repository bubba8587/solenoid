import type { GammaInvNode } from "../nodes/dist-continuous";
import { makeNodeComponent } from "./standardNode";

export const GammaInvComponent = makeNodeComponent<GammaInvNode>((n) => n.cachedResult);
