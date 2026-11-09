// [[C17]] shareImpl, [[C51]] formulaNaming

import type { PackFormula } from "./packShared";

export const HEALTH_PACK_FORMULAS: PackFormula[] = [
  { name: "HEARTRATEZONES", arity: [1, 2], signature: "max HR, resting HR — five [low, high] rows" },
];
