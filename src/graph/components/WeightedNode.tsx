import { WEIGHTED_OP_META, type WeightedOp, type WeightedNode as WeightedNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const WeightedComponent = makeOpNodeComponent<WeightedOp, WeightedNodeType>(WEIGHTED_OP_META, (n) => n.cachedResult);
