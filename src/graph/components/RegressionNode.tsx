import { REGRESSION_OP_META, type RegressionOp, type RegressionNode as RegressionNodeType } from "../rete-nodes";
import { makeOpNodeComponent } from "./standardNode";

export const RegressionComponent = makeOpNodeComponent<RegressionOp, RegressionNodeType>(REGRESSION_OP_META, (n) => n.cachedResult);
