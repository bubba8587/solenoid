// [[C17]] shareImpl, [[C51]] formulaNaming

import { hrZonesMatrix } from "../nodes/healthOps";
import type { PackFormula } from "./packShared";

export const HEALTH_PACK_FORMULAS: PackFormula[] = [
  {
    name: "HEARTRATEZONES",
    impl: (max, resting) => {
      if (max == null) return null;
      const m = Number(max);
      if (!Number.isFinite(m)) return null;
      const r = resting == null ? null : Number(resting);
      return hrZonesMatrix(m, r !== null && Number.isFinite(r) ? r : null);
    },
    returns: "number", rank: "matrix", arity: [1, 2],
    signature: "max HR, resting HR — five [low, high] rows",
  },
];
