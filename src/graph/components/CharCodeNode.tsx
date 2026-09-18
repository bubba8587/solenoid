import type { CharCodeNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const CharCodeComponent = makeNodeComponent<CharCodeNode>((n) => n.cachedResult);
