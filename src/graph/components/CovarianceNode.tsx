import { COVARIANCE_OP_META, type CovarianceOp, type CovarianceNode as CovarianceNodeType } from "../nodeClasses";
import { makeOpNodeComponent } from "./standardNode";

export const CovarianceComponent = makeOpNodeComponent<CovarianceOp, CovarianceNodeType>(COVARIANCE_OP_META, (n) => n.cachedResult);
