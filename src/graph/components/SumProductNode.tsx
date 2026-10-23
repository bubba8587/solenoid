import { SUM_PRODUCT_OP_META, type SumProductOp, type SumProductNode as SumProductNodeType } from "../nodeClasses";
import { makeOpNodeComponent } from "./standardNode";

export const SumProductComponent = makeOpNodeComponent<SumProductOp, SumProductNodeType>(SUM_PRODUCT_OP_META, (n) => n.cachedResult);
