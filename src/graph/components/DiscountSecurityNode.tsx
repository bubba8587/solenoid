import { DISCOUNT_SECURITY_META, type DiscountSecurityNode, type DiscountSecurityOp } from "../rete-nodes";
import { makeSpecOpComponent } from "./specOpNode";

export const DiscountSecurityComponent = makeSpecOpComponent<DiscountSecurityOp, DiscountSecurityNode>(DISCOUNT_SECURITY_META);
