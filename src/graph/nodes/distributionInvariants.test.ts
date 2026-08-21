import { describe, it, expect } from "vitest";
import { DIST_SPECS } from "./distribution";

// The distribution family is internal (hand-rolled). These invariants hold by the math of
// each distribution, so they need no oracle. (Full sweep found only the HYPGEOM cdf hole.)
const cdf = (x: number, p: number[]) => DIST_SPECS.hypgeom.compute("cdf", x, p);

describe("HYPGEOM cdf is 1 above the support ceiling, not blank", () => {
  const p = [10, 3, 20]; // [n, M, N]; support is [0, min(n,M)] = [0, 3]
  it("cdf reaches 1 at the ceiling and stays 1 above it (like BINOM/POISSON)", () => {
    expect(cdf(3, p)).toBeCloseTo(1, 12);   // at the ceiling
    expect(cdf(5, p)).toBeCloseTo(1, 12);   // above it — was null
    expect(cdf(8, p)).toBeCloseTo(1, 12);
  });
  it("cdf is non-decreasing and starts below 1 inside the support", () => {
    const c0 = cdf(0, p) as number;
    const c1 = cdf(1, p) as number;
    const c2 = cdf(2, p) as number;
    expect(c0).toBeGreaterThan(0);
    expect(c1).toBeGreaterThanOrEqual(c0);
    expect(c2).toBeGreaterThanOrEqual(c1);
    expect(c2).toBeLessThan(1);
  });
  it("invalid parameters are still a blank, not a fake 1", () => {
    expect(cdf(2, [10, 25, 20])).toBeNull(); // M > N
  });
});
