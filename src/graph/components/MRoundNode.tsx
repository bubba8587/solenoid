import { MROUND_OP_META, type MRoundOp, type MRoundNode } from "../nodeClasses";
import { makeOpNodeComponent } from "./standardNode";

export const MRoundComponent = makeOpNodeComponent<MRoundOp, MRoundNode>(MROUND_OP_META, (n) => n.cachedResult);
