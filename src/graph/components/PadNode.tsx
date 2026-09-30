import { PAD_OP_META, type PadDir, type PadNode as PadNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const PadComponent = makeOpNodeComponent<PadDir, PadNodeType>(PAD_OP_META, (n) => n.cachedList);
