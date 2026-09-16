import { BOND_PRICING_META, type BondPricingNode, type BondPricingOp } from "../rete-nodes";
import { makeSpecOpComponent } from "./specOpNode";

export const BondPricingComponent = makeSpecOpComponent<BondPricingOp, BondPricingNode>(BOND_PRICING_META);
