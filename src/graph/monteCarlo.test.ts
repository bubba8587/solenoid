import { describe, it, expect } from "vitest";
import {
  mulberry32, sampleStandardNormal, sampleUncertain, summarizeSamples, histogram,
} from "./monteCarlo";

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
