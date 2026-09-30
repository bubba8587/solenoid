import { TEXT_FIND_OP_META, type TextFindOp, type TextFindNode as TextFindNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const TextFindComponent = makeOpNodeComponent<TextFindOp, TextFindNodeType>(TEXT_FIND_OP_META, (n) => n.cachedResult);
