import { ReverseTextNode as ReverseTextNodeType, SpellNumberNode as SpellNumberNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";

export const ReverseTextComponent = makeNodeComponent<ReverseTextNodeType>((n) => n.cachedText);
export const SpellNumberComponent = makeNodeComponent<SpellNumberNodeType>((n) => n.cachedText);
