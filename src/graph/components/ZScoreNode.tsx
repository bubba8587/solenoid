import type { ZScoreNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ZScoreComponent = makeNodeComponent<ZScoreNode>((n) => n.cachedList);
