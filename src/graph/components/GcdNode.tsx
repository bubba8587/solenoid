import { GCD_OP_META, type GcdOp, type GCDNode as GCDNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const GcdComponent = makeOpNodeComponent<GcdOp, GCDNodeType>(GCD_OP_META, (n) => n.cachedResult);
