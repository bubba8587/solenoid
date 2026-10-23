// [[C120]] linearWork
import { it, expect } from "vitest";
import { coreFunction } from "../coreFunction";
import { isSolError } from "../../../src/graph/errorValue";

it("an exact test past a million outcomes answers #DOMAIN! at once instead of summing them", () => {
  const t = performance.now();
  for (const [name, args] of [["BINOMTEST", [5e11, 1e12, 0.5]], ["FISHEREXACT", [1e12, 1e12, 1e12, 1e12]]] as const) {
    const r = coreFunction(name)!(...args);
    expect(isSolError(r) && r.code).toBe("#DOMAIN!");
  }
  expect(performance.now() - t).toBeLessThan(500);
  expect(coreFunction("BINOMTEST")!(3, 10, 0.5)).toBeCloseTo(0.34375, 12);
});
