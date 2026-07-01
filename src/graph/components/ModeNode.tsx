import type { ModeNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ModeComponent = makeNodeComponent<ModeNode>((n) => n.cachedResult);
