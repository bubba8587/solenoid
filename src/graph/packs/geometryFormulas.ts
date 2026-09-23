// [[D19]] implReteFree, [[C17]] shareImpl, [[C51]] formulaNaming

import { solveGivenParts, type TriangleGiven } from "../nodes/triangleOps";
import type { PackFormula } from "./packShared";

export const GEOMETRY_PACK_FORMULAS: PackFormula[] = [
  {
    name: "TRIANGLESOLVER",
    impl: (...args: unknown[]) => {
      const keys = ["a", "b", "c", "A", "B", "C"] as const;
      const given: Record<string, number> = {};
      let any = false;
      keys.forEach((k, i) => {
        const v = args[i];
        if (typeof v === "number" && Number.isFinite(v)) { given[k] = v; any = true; }
      });
      if (!any) return null;
      const r = solveGivenParts(given as TriangleGiven);
      return keys.map((k) => r.values[k]);
    },
    returns: "number", rank: "list", listArgs: true, arity: [3, 6],
    signature: "a, b, c, A°, B°, C° — any 3 incl. a side; returns all six",
  },
];
