import { describe, it, expect } from "vitest";
import {
  mulberry32, sampleStandardNormal, sampleUncertain, summarizeSamples, histogram,
} from "../../src/graph/monteCarlo";

describe("mulberry32 seeded PRNG", () => {
  it("is deterministic — the same seed replays the identical sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds diverge", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("distribution sampling", () => {
  it("standard-normal draws have ~0 mean and ~1 sd over many samples", () => {
    const rng = mulberry32(123);
    const n = 20000;
    let sum = 0, sumSq = 0;
    for (let i = 0; i < n; i++) { const z = sampleStandardNormal(rng); sum += z; sumSq += z * z; }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(mean).toBeCloseTo(0, 1);
    expect(sd).toBeCloseTo(1, 1);
  });

  it("uniform draws stay within mean ± spread", () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 2000; i++) {
      const x = sampleUncertain(100, { kind: "uniform", spread: 5 }, rng);
      expect(x).toBeGreaterThanOrEqual(95);
      expect(x).toBeLessThanOrEqual(105);
    }
  });

  it("a non-positive spread is a point value (no draw consumed)", () => {
    const rng = mulberry32(3);
    expect(sampleUncertain(42, { kind: "normal", spread: 0 }, rng)).toBe(42);
    expect(sampleUncertain(42, { kind: "uniform", spread: -1 }, rng)).toBe(42);
  });

  it("seeded sampling is reproducible end-to-end", () => {
    const draw = (seed: number) => {
      const rng = mulberry32(seed);
      return Array.from({ length: 5 }, () => sampleUncertain(10, { kind: "normal", spread: 2 }, rng));
    };
    expect(draw(99)).toEqual(draw(99));
  });
});

describe("summarizeSamples", () => {
  it("returns sample mean ± unbiased (N−1) sd", () => {
    const r = summarizeSamples([2, 4, 6]);
    expect(r.value).toBeCloseTo(4, 10);
    // variance = ((−2)² + 0 + 2²) / (3−1) = 8/2 = 4 → sd = 2
    expect(r.error).toBeCloseTo(2, 10);
    expect(r.samples).toEqual([2, 4, 6]);
  });

  it("a single draw has zero spread", () => {
    const r = summarizeSamples([7]);
    expect(r.value).toBe(7);
    expect(r.error).toBe(0);
  });

  it("drops non-finite draws before summarizing", () => {
    const r = summarizeSamples([1, NaN, 3, Infinity]);
    expect(r.value).toBeCloseTo(2, 10);
  });

  it("an all-empty set yields NaN ± 0", () => {
    const r = summarizeSamples([]);
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toBe(0);
  });
});

describe("histogram", () => {
  it("bins values into equal-width buckets, the max landing in the last bin", () => {
    const { counts, min, max } = histogram([0, 1, 2, 3, 4], 5);
    expect(min).toBe(0);
    expect(max).toBe(4);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(1); // 4 (the max) is counted
  });

  it("a zero-range set is a single full bucket", () => {
    const { counts } = histogram([5, 5, 5]);
    expect(counts).toEqual([3]);
  });
});

describe("correlated inputs (Gaussian copula) — each marginal kept, only the dependence changes", () => {
  it("parses `a ~ b = 0.7; c ~ d = -0.3`, rejects malformed / out-of-range / self pairs", async () => {
    const { parseCorrelations } = await import("../../src/graph/monteCarlo");
    const r = parseCorrelations("price ~ volume = 0.7; cost ~ price = -0.3, x ~ x = 0.5, y ~ z = 1.5, junk");
    expect(r.pairs).toEqual([{ a: "price", b: "volume", rho: 0.7 }, { a: "cost", b: "price", rho: -0.3 }]);
    expect(r.rejected).toEqual(["x ~ x = 0.5", "y ~ z = 1.5", "junk"]);
  });
  it("induces the requested correlation between two normal inputs and keeps their mean / sd", async () => {
    const { mulberry32, parseCorrelations, correlationCholesky, sampleCorrelated } = await import("../../src/graph/monteCarlo");
    const rng = mulberry32(11);
    const L = correlationCholesky(["a", "b"], parseCorrelations("a ~ b = 0.8").pairs);
    const specs = [{ mean: 100, spec: { kind: "normal" as const, spread: 10 } }, { mean: 5, spec: { kind: "uniform" as const, spread: 2 } }];
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < 6000; i++) { const [x, y] = sampleCorrelated(specs, L, rng); xs.push(x); ys.push(y); }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const mx = mean(xs), my = mean(ys);
    const sx = Math.sqrt(mean(xs.map((v) => (v - mx) ** 2))), sy = Math.sqrt(mean(ys.map((v) => (v - my) ** 2)));
    expect(mx).toBeCloseTo(100, 0); expect(sx).toBeCloseTo(10, 0);       // normal marginal kept
    expect(my).toBeCloseTo(5, 0); expect(sy).toBeCloseTo(2 / Math.sqrt(3), 1); // uniform(3, 7) marginal kept
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(3); expect(Math.max(...ys)).toBeLessThanOrEqual(7);
    const r = mean(xs.map((v, i) => ((v - mx) / sx) * ((ys[i] - my) / sy)));
    expect(r).toBeGreaterThan(0.7); expect(r).toBeLessThan(0.85);          // ≈ 0.8 on the normal scores, slightly less after the uniform map
  });
  it("an inconsistent correlation set is softened to the nearest feasible one, never refused", async () => {
    const { correlationCholesky } = await import("../../src/graph/monteCarlo");
    // a~b = 0.9, b~c = 0.9, a~c = -0.9 cannot all hold; the factor still exists.
    const L = correlationCholesky(["a", "b", "c"], [{ a: "a", b: "b", rho: 0.9 }, { a: "b", b: "c", rho: 0.9 }, { a: "a", b: "c", rho: -0.9 }]);
    expect(L).toHaveLength(3);
    expect(L.every((row) => row.every(Number.isFinite))).toBe(true);
    expect(L[1][0]).toBeLessThan(0.9); // shrunk
  });
});
