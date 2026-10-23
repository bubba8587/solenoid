import { DOLLAR_OP_META, type DollarOp, type DollarNode as DollarNodeType } from "../nodeClasses";
import { makeOpNodeComponent } from "./standardNode";

export const DollarComponent = makeOpNodeComponent<DollarOp, DollarNodeType>(DOLLAR_OP_META, (n) => n.cachedResult);
