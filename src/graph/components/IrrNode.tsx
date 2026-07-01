import type { IrrNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const IrrComponent = makeNodeComponent<IrrNode>((n) => n.cachedResult);
