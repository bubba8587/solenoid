// [[C17]] shareImpl, [[C51]] formulaNaming

import type { PackFormula } from "./packShared";

export const GEOMETRY_PACK_FORMULAS: PackFormula[] = [
  { name: "TRIANGLESOLVER", arity: [3, 8], signature: "a, b, c, [A°], [B°], [C°], [area], [perimeter]", emptySlotsLeftOut: true },
];
