import { DISCOUNT_SECURITY_META, type DiscountSecurityNode, type DiscountSecurityOp } from "../nodeClasses";
import { makeSpecOpComponent } from "./specOpNode";

export const DiscountSecurityComponent = makeSpecOpComponent<DiscountSecurityOp, DiscountSecurityNode>(DISCOUNT_SECURITY_META);
