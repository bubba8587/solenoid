import type { LinSpaceNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const LinSpaceComponent = makeNodeComponent<LinSpaceNode>((n) => n.cachedList);
