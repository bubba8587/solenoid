import { FISHER_OP_META, type FisherOp, type FisherNode as FisherNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const FisherComponent = makeOpNodeComponent<FisherOp, FisherNodeType>(FISHER_OP_META, (n) => n.cachedResult);
