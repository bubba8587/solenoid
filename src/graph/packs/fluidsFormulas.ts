// [[C17]] shareImpl, [[C51]] formulaNaming

import type { PackFormula } from "./packShared";

export const FLUIDS_PACK_FORMULAS: PackFormula[] = [
  { name: "COLEBROOK", arity: [2, 2], signature: "Re, relative roughness ε/D" },
  { name: "PIPEROUGHNESS", arity: [1, 1], signature: "material — pvc, copper, steel, castiron…" },
];
