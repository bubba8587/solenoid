import { ROUNDN_OP_META, type RoundNOp, type RoundNNode as RoundNNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const RoundNComponent = makeOpNodeComponent<RoundNOp, RoundNNodeType>(ROUNDN_OP_META, (n) => n.cachedResult);
