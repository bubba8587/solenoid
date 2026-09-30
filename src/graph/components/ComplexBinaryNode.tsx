import { COMPLEX_BINARY_OP_META, type ComplexBinaryOp, type ComplexBinaryNode as ComplexBinaryNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const ComplexBinaryComponent = makeOpNodeComponent<ComplexBinaryOp, ComplexBinaryNodeType>(COMPLEX_BINARY_OP_META, (n) => n.cachedResult);
