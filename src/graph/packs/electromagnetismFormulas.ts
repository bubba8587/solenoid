// [[C17]] shareImpl, [[C51]] formulaNaming

import type { PackFormula } from "./packShared";

export const ELECTROMAGNETISM_PACK_FORMULAS: PackFormula[] = [
  { name: "EMSPECTRUMBAND", arity: [1, 2], signature: "frequency Hz — or blank, wavelength m", emptySlotsLeftOut: true, emptySlotShown: "none" },
  { name: "PHYSICSCONSTANT", arity: [1, 1], signature: "id — c, G, h, e, kb, na…" },
];
