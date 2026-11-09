import { BOND_PRICING_META, type BondPricingNode, type BondPricingOp } from "../nodeClasses";
import { makeSpecOpComponent } from "./specOpNode";

export const BondPricingComponent = makeSpecOpComponent<BondPricingOp, BondPricingNode>(BOND_PRICING_META);
