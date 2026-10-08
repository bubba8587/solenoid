import { TWO_INPUT_MATH_OP_META, type TwoInputMathOp, type TwoInputMathNode as TwoInputMathNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const TwoInputMathComponent = makeOpNodeComponent<TwoInputMathOp, TwoInputMathNodeType>(TWO_INPUT_MATH_OP_META, (n) => n.cachedResult);
