// [[D19]] implReteFree, [[C17]] shareImpl, [[C51]] formulaNaming

import { colebrookFriction, PIPE_ROUGHNESS } from "../nodes/fluidsOps";
import { solError } from "../errorValue";
import type { PackFormula } from "./packShared";

export const FLUIDS_PACK_FORMULAS: PackFormula[] = [
  {
    name: "COLEBROOK",
    impl: (re, rr) => {
      if (re == null || rr == null) return null;
      const r = Number(re), e = Number(rr);
      if (!Number.isFinite(r) || !Number.isFinite(e)) return null;
      return colebrookFriction(r, e);
    },
    returns: "number", arity: [2, 2],
    signature: "Re, relative roughness ε/D",
  },
  {
    name: "PIPEROUGHNESS",
    impl: (material) => {
      if (material == null) return null;
      const id = String(material);
      const row = PIPE_ROUGHNESS.find((m) => m.id === id);
      return row ? row.mm : solError("#NAME?", `Unknown material "${id}" — pvc, copper, steel, castiron…`);
    },
    returns: "number", arity: [1, 1],
    signature: "material — pvc, copper, steel, castiron…",
  },
];
