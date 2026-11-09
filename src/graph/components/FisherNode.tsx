import { FISHER_OP_META, type FisherOp, type FisherNode as FisherNodeType } from "../nodeClasses";
import { makeOpNodeComponent } from "./standardNode";

export const FisherComponent = makeOpNodeComponent<FisherOp, FisherNodeType>(FISHER_OP_META, (n) => n.cachedResult);
