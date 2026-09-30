import { BITWISE_OP_META, type BitwiseOp, type BitwiseNode as BitwiseNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const BitwiseComponent = makeOpNodeComponent<BitwiseOp, BitwiseNodeType>(BITWISE_OP_META, (n) => n.cachedResult);
