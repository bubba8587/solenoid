import { COMPLEX_UNARY_OP_META, type ComplexUnaryOp, type ComplexUnaryNode as ComplexUnaryNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const ComplexUnaryComponent = makeOpNodeComponent<ComplexUnaryOp, ComplexUnaryNodeType>(COMPLEX_UNARY_OP_META, (n) => n.cachedResult);
