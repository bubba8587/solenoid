// [[C17]] shareImpl, [[C51]] formulaNaming

import type { PackFormula } from "./packShared";

export const EARTHSKY_PACK_FORMULAS: PackFormula[] = [
  { name: "SUNPOSITION", arity: [3, 4], signature: "datetime UTC, lat, lon, [part (elevation)]" },
  { name: "SUNRISE", arity: [3, 3], signature: "date, lat, lon — UTC; blank in polar night/day" },
  { name: "SUNSET", arity: [3, 3], signature: "date, lat, lon — UTC; blank in polar night/day" },
  { name: "DAYLENGTH", arity: [3, 3], signature: "date, lat, lon — hours" },
  { name: "MOONPHASE", arity: [1, 2], signature: "date, [part (phase)]" },
];
