import type { NpvNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const NpvComponent = makeNodeComponent<NpvNode>((n) => n.cachedResult);
