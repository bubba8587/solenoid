import type { WrapTextNode as WrapTextNodeType } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const WrapTextComponent = makeNodeComponent<WrapTextNodeType>((n) => n.cachedResult);
