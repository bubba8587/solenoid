import { CORREL_OP_META, type CorrelOp, type CorrelNode as CorrelNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const CorrelComponent = makeOpNodeComponent<CorrelOp, CorrelNodeType>(CORREL_OP_META, (n) => n.cachedResult);
