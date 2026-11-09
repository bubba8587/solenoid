import type { TruncateTextNode as TruncateTextNodeType } from "../nodeClasses";
import { makeNodeComponent } from "./standardNode";

export const TruncateTextComponent = makeNodeComponent<TruncateTextNodeType>((n) => n.cachedText);
