import { COMBINATORICS_OP_META, type CombinatoricsOp, type CombinatoricsNode as CombinatoricsNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const CombinatoricsComponent = makeOpNodeComponent<CombinatoricsOp, CombinatoricsNodeType>(COMBINATORICS_OP_META, (n) => n.cachedResult);
