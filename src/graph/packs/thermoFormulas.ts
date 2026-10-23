// [[C17]] shareImpl, [[C51]] formulaNaming

import type { PackFormula } from "./packShared";

export const THERMO_PACK_FORMULAS: PackFormula[] = [
  { name: "STANDARDATMOSPHERE", arity: [1, 2], signature: "altitude m, [property (pressure)]" },
  { name: "ANTOINE", arity: [2, 2], signature: "substance, T °C — vapor pressure in Pa" },
];
