// [[C17]] shareImpl
import { describe, it, expect } from "vitest";
import { stlDecompose, runHW } from "../../../src/graph/nodes/forecastOps";

// STL (R stl s.window="periodic") on a hand-built trend + season: the decomposition of a
// clean signal must recover an exactly-periodic seasonal and a ~zero residual (a linear
// trend is recovered exactly by the local-linear lowess).
describe("stlDecompose (STL, periodic seasonal)", () => {
  const m = 4, n = 16;
  const season = [3, -1, 0, -2]; // mean 0, period 4
  const y = Array.from({ length: n }, (_, i) => 10 + 0.5 * i + season[i % m]); // linear trend + season

  it("recovers a ~zero residual for a pure trend + season", () => {
    const d = stlDecompose(y, m)!;
    expect(d.residual.every((r) => typeof r === "number" && Math.abs(r as number) < 1e-4)).toBe(true);
  });

  it("the seasonal component is EXACTLY periodic", () => {
    const s = stlDecompose(y, m)!.seasonal as number[];
    for (let i = m; i < n; i++) expect(s[i]).toBeCloseTo(s[i % m], 10);
    // and it sums to ~0 over one period (centred)
    expect(s.slice(0, m).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
  });

  it("the trend is the linear component (no blank ends, unlike the classical filter)", () => {
    const t = stlDecompose(y, m)!.trend as number[];
    expect(t.every((v) => v !== null)).toBe(true);
    expect(t[0]).toBeCloseTo(10, 4);
    expect(t[n - 1]).toBeCloseTo(10 + 0.5 * (n - 1), 4);
  });

  it("null for too few periods, a bad period, or a gappy series", () => {
    expect(stlDecompose(y, 1)).toBeNull();          // period < 2
    expect(stlDecompose(y.slice(0, 6), m)).toBeNull(); // n < 2*m
    expect(stlDecompose([1, 2, null, 4, 5, 6, 7, 8], 2)).toBeNull(); // a gap
  });
});

describe("runHW (additive Holt–Winters, ETS AAA recursion)", () => {
  it("updates the season against the previous level plus the previous trend", () => {
    // y = 10, 20, 12, 22 with season 2 and α = β = γ = 0.5: level 15, trend 1, season [−5, 5] at the start.
    // t0: ℓ = 15.5, b = 0.75, s0 = 0.5·(10 − 15 − 1) + 0.5·(−5) = −5.5
    // t1: ℓ = 15.625, b = 0.4375, s1 = 0.5·(20 − 15.5 − 0.75) + 0.5·5 = 4.375
    // t2: prediction 15.625 + 0.4375 − 5.5; ℓ = 16.78125, b = 0.796875; t3: prediction 16.78125 + 0.796875 + 4.375
    const { fit } = runHW([10, 20, 12, 22, 14, 24], 2, 0.5, 0.5, 0.5);
    expect(fit.fitted.slice(0, 4)).toEqual([11, 21.25, 10.5625, 21.953125]);
  });
});
