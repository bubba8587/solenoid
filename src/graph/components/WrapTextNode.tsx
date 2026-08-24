import type { WrapTextNode as WrapTextNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const WrapTextComponent = makeNodeComponent<WrapTextNodeType>((n) => n.cachedResult);
