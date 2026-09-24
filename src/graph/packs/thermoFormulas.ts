// [[C17]] shareImpl, [[C51]] formulaNaming

import { standardAtmosphere, antoinePressure, ANTOINE, type AntoineOp } from "../nodes/thermoOps";
import { solError, isSolError } from "../errorValue";
import type { PackFormula } from "./packShared";

export const THERMO_PACK_FORMULAS: PackFormula[] = [
  {
    name: "STANDARDATMOSPHERE",
    impl: (alt, property) => {
      if (alt == null) return null;
      const z = Number(alt);
      if (!Number.isFinite(z)) return null;
      const key = property == null ? "pressure" : String(property).toLowerCase();
      const field = ({ temp: "T", temperature: "T", pressure: "p", density: "rho", sound: "a" } as const)[key];
      if (!field) return solError("#VALUE!", `Unknown property "${key}" — temp, pressure, density, sound`);
      const pt = standardAtmosphere(z);
      return isSolError(pt) ? pt : pt[field];
    },
    returns: "number", arity: [1, 2],
    signature: "altitude m, [property (pressure)]",
  },
  {
    name: "ANTOINE",
    impl: (substance, t) => {
      if (substance == null || t == null) return null;
      const id = String(substance) as AntoineOp;
      const meta = ANTOINE[id];
      if (!meta) return solError("#NAME?", `Unknown substance "${id}" — water, ethanol, acetone…`);
      const tc = Number(t);
      if (!Number.isFinite(tc)) return null;
      return tc <= -meta.C
        ? solError("#DOMAIN!", "Below the equation's temperature range")
        : antoinePressure(id, tc);
    },
    returns: "number", arity: [2, 2],
    signature: "substance, T °C — vapor pressure in Pa",
  },
];
