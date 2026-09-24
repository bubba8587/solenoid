// [[C17]] shareImpl, [[C51]] formulaNaming

import { emSpectrum } from "../nodes/emSpectrumOps";
import { PHYS_CONSTANTS, type PhysConstOp } from "../nodes/physicsConstantsOps";
import { solError, isSolError } from "../errorValue";
import type { PackFormula } from "./packShared";

export const ELECTROMAGNETISM_PACK_FORMULAS: PackFormula[] = [
  {
    name: "EMSPECTRUMBAND",
    impl: (freq, wavelength) => {
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const r = emSpectrum(num(freq), num(wavelength));
      if (r === null) return null;
      return isSolError(r) ? r : r.band;
    },
    returns: "string", arity: [1, 2],
    signature: "frequency Hz — or blank, wavelength m",
  },
  {
    name: "PHYSICSCONSTANT",
    impl: (id) => {
      if (id == null) return null;
      const k = String(id);
      const m = PHYS_CONSTANTS[k as PhysConstOp];
      return m ? m.value : solError("#NAME?", `Unknown constant "${k}" — c, G, h, e, kb, na… (case matters)`);
    },
    returns: "number", arity: [1, 1],
    signature: "id — c, G, h, e, kb, na…",
  },
];
