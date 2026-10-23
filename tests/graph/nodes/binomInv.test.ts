// [[C120]] linearWork
import { it, expect } from "vitest";
import { coreFunction } from "../coreFunction";

it("BINOM.INV past a million trials answers at once, near the normal approximation", () => {
  const inv = coreFunction("BINOM.INV")!;
  for (const n of [2e6, 1e8, 1e12]) {
    const t = performance.now();
    const k = inv(n, 0.5, 0.999) as number;
    expect(performance.now() - t).toBeLessThan(500);
    const z = (k - n / 2) / Math.sqrt(n / 4);
    expect(z).toBeGreaterThan(3.08);
    expect(z).toBeLessThan(3.1);
  }
});

it("BINOM.INV and BINOM.DIST stay right near the median past a million trials", () => {
  const inv = coreFunction("BINOM.INV")!, dist = coreFunction("BINOM.DIST")!;
  expect(inv(1e8, 0.5, 0.4)).toBe(49998733);
  expect(inv(1e9, 0.5, 0.1)).toBe(499979737);
  expect(dist(5e8, 1e9, 0.5, true) as number).toBeCloseTo(0.5, 4);
});
