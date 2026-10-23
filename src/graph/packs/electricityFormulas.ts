// [[C17]] shareImpl, [[C51]] formulaNaming

import type { PackFormula } from "./packShared";

export const ELECTRICITY_PACK_FORMULAS: PackFormula[] = [
  { name: "PARALLELCOMBINE", arity: [1, 255], signature: "value1, [value2], …" },
  { name: "ESERIESVALUE", arity: [1, 2], signature: "value, [series (E24)]" },
  { name: "AWGWIRE", arity: [1, 2], signature: "gauge, [property (diameter)]" },
  { name: "RESISTORCOLORCODE", arity: [4, 5], signature: "digit, digit, multiplier, tolerance — or 5-band with a 3rd digit" },
];
