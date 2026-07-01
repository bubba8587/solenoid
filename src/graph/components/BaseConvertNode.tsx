import type { BaseConvertNode } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const BaseConvertComponent = makeNodeComponent<BaseConvertNode>((n) => n.cachedResult);
