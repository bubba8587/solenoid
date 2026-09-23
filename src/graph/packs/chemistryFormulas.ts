// [[D19]] implReteFree, [[C17]] shareImpl, [[C51]] formulaNaming

import { ELEMENTS, ELEMENT_BY_SYMBOL, molarMass } from "../nodes/chemistryOps";
import { solError } from "../errorValue";
import type { PackFormula } from "./packShared";

export const CHEMISTRY_PACK_FORMULAS: PackFormula[] = [
  {
    name: "ELEMENT",
    impl: (el, property) => {
      if (el == null) return null;
      const meta = typeof el === "number"
        ? ELEMENTS.find((m) => m.n === el)
        : ELEMENT_BY_SYMBOL.get(String(el));
      if (!meta) return solError("#NAME?", `Unknown element "${el}"`);
      const p = property == null ? "mass" : String(property).toLowerCase();
      if (p === "mass") return meta.mass;
      if (p === "number") return meta.n;
      if (p === "name") return meta.name;
      if (p === "symbol") return meta.symbol;
      if (p === "period") return meta.period;
      return solError("#VALUE!", `Unknown property "${p}" — mass, number, name, symbol, period`);
    },
    returns: "any", arity: [1, 2],
    signature: "symbol or atomic number, [property (mass)]",
  },
  {
    name: "MOLARMASS",
    impl: (formula) => {
      if (formula == null) return null;
      const s = String(formula);
      return s.trim() ? molarMass(s) : null;
    },
    returns: "number", arity: [1, 1],
    signature: "chemical formula — H2O, CuSO4·5H2O",
  },
];
