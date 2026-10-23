import type { BaseConvertNode } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const BaseConvertComponent = makeNodeComponent<BaseConvertNode>((n) => n.cachedResult);
