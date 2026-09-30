import { CONFIDENCE_OP_META, type ConfidenceOp, type ConfidenceNode as ConfidenceNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const ConfidenceComponent = makeOpNodeComponent<ConfidenceOp, ConfidenceNodeType>(CONFIDENCE_OP_META, (n) => n.cachedResult);
