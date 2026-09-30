import { ARITHMETIC_OP_META, type ArithmeticOp, type ArithmeticNode as ArithmeticNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const ArithmeticComponent = makeOpNodeComponent<ArithmeticOp, ArithmeticNodeType>(ARITHMETIC_OP_META, (n) => n.cachedResult);
