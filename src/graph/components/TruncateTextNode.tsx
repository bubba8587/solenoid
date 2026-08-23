import type { TruncateTextNode as TruncateTextNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const TruncateTextComponent = makeNodeComponent<TruncateTextNodeType>((n) => n.cachedText);
