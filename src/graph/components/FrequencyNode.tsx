import type { FrequencyNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const FrequencyComponent = makeNodeComponent<FrequencyNode>((n) => n.cachedList);
