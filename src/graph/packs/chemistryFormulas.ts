// [[C17]] shareImpl, [[C51]] formulaNaming

import type { PackFormula } from "./packShared";

export const CHEMISTRY_PACK_FORMULAS: PackFormula[] = [
  { name: "ELEMENT", arity: [1, 2], signature: "symbol or atomic number, [property (mass)]" },
  { name: "MOLARMASS", arity: [1, 1], signature: "chemical formula — H2O, CuSO4·5H2O" },
];
