import { PARITY_OP_META, type ParityOp, type IsEvenOddNode as IsEvenOddNodeType } from "../nodeClasses";
import { makeOpNodeComponent } from "./standardNode";

export const IsEvenOddComponent = makeOpNodeComponent<ParityOp, IsEvenOddNodeType>(PARITY_OP_META, (n) => n.cachedResult);
