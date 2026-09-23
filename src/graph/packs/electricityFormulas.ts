// [[D19]] implReteFree, [[C17]] shareImpl, [[C51]] formulaNaming

import { parallelCombine, awgWire, nearestESeries, decodeResistor, E_SERIES, type ESeriesOp } from "../nodes/electricalOps";
import { solError, isSolError } from "../errorValue";
import type { PackFormula } from "./packShared";

export const ELECTRICITY_PACK_FORMULAS: PackFormula[] = [
  {
    name: "PARALLELCOMBINE",
    impl: (...args: unknown[]) => {
      const cells = args.flatMap((a) => (Array.isArray(a) ? a : a == null ? [] : [a]));
      return parallelCombine(cells as Parameters<typeof parallelCombine>[0]);
    },
    returns: "number", listArgs: true, arity: [1, 255],
    signature: "value1, [value2], …",
  },
  {
    name: "ESERIESVALUE",
    impl: (value, series) => {
      if (value == null) return null;
      const v = Number(value);
      if (!Number.isFinite(v)) return null;
      const s = (series == null ? "E24" : String(series).toUpperCase()) as ESeriesOp;
      if (!(s in E_SERIES)) return solError("#VALUE!", `Unknown E-series "${s}" — E3, E6, E12, E24, E48, E96`);
      if (v <= 0) return solError("#DOMAIN!", "A component value must be a positive number");
      return nearestESeries(v, s);
    },
    returns: "number", arity: [1, 2],
    signature: "value, [series (E24)]",
  },
  {
    name: "AWGWIRE",
    impl: (gauge, property) => {
      if (gauge == null) return null;
      const n = Number(gauge);
      if (!Number.isFinite(n)) return null;
      const p = property == null ? "diameter" : String(property).toLowerCase();
      if (!["diameter", "area", "resistance", "ampacity"].includes(p)) {
        return solError("#VALUE!", `Unknown property "${p}" — diameter, area, resistance, ampacity`);
      }
      const w = awgWire(n);
      if (isSolError(w)) return w;
      return w[p as keyof typeof w];
    },
    returns: "number", arity: [1, 2],
    signature: "gauge, [property (diameter)]",
  },
  {
    name: "RESISTORCOLORCODE",
    impl: (...bands: unknown[]) => {
      if (bands.some((b) => b == null)) return null;
      const c = bands.map((b) => String(b).toLowerCase());
      const r = c.length === 5
        ? decodeResistor(c[0], c[1], c[2], c[3], c[4], true)
        : decodeResistor(c[0], c[1], "black", c[2], c[3], false);
      return isSolError(r) ? r : r.ohms;
    },
    returns: "number", arity: [4, 5],
    signature: "digit, digit, multiplier, tolerance — or 5-band with a 3rd digit",
  },
];
