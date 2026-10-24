// [[C120]] linearWork
import { it, expect } from "vitest";
import { coreFunction } from "../coreFunction";
it("the cumulative hypergeometric sums only the window where terms are nonzero: the full loop's answer, fast", () => {
  const f = coreFunction("HYPGEOM.DIST")!;
  // Against the full loop on mid-size cases where the window applies.
  let seed = 9; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const full = (k: number, n: number, M: number, N: number) => {
    const lo = Math.max(0, n + M - N), hi = Math.min(n, M); let sum = 0;
    for (let j = lo; j <= Math.min(k, hi); j++) sum += f(j, n, M, N, false) as number;
    return Math.min(1, Math.max(0, sum));
  };
  for (let t = 0; t < 40; t++) {
    const N = 20000 + Math.floor(r() * 60000), M = Math.floor(r() * N), n = Math.floor(r() * N), k = Math.floor(r() * Math.min(n, M));
    expect(f(k, n, M, N, true)).toBe(full(k, n, M, N));
  }
  const t0 = performance.now();
  const v = f(1e8, 2e8, 4e8, 8e8, true) as number;
  expect(performance.now() - t0).toBeLessThan(3000);
  expect(v).toBeCloseTo(0.5, 3);
});
