import type { NormInvNode } from "../nodes/dist-normal";
import { makeNodeComponent } from "./standardNode";

export const NormInvComponent = makeNodeComponent<NormInvNode>((n) => n.cachedResult);
