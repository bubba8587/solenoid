import type { NormSInvNode } from "../nodes/dist-normal";
import { makeNodeComponent } from "./standardNode";

export const NormSInvComponent = makeNodeComponent<NormSInvNode>((n) => n.cachedResult);
