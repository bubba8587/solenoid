import type { FrequencyNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const FrequencyComponent = makeNodeComponent<FrequencyNode>((n) => n.cachedList);
