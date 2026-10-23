// [[C17]] shareImpl, [[C51]] formulaNaming

import type { PackFormula } from "./packShared";

export const GEOMETRY_PACK_FORMULAS: PackFormula[] = [
  { name: "TRIANGLESOLVER", arity: [3, 6], signature: "a, b, c, A°, B°, C° — any 3 incl. a side; returns all six", emptySlotsLeftOut: true },
];
