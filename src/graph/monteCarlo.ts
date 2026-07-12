// Seeded, deterministic Monte Carlo sampling for the composite "montecarlo" run
// mode. Pure — no React/Rete deps — so the composite driver's draws are
// reproducible (same seed → identical sequence) and unit-testable in isolation.
//
// SCOPE (author, 2026-07-12): this is the ONLY sampler in the app and it drives
// ONLY the composite subsystem. A composite input marker declares a distribution
// (`uncertainty` spread + `distribution` kind); the driver samples every uncertain
// input N times, re-runs the container, and summarizes each output port into an
// UncertainNumber (mean ± sd). See valueKinds.ts `UncertainNumber` for the scope
// rationale and the analytic-propagation companion.

import { uncertain, type UncertainNumber } from "./valueKinds";

export type DistributionKind = "normal" | "uniform";

/** How a composite input marker's `± spread` is drawn each iteration. `spread`
 *  is the marker's `uncertainty` field: a 1σ for normal, a ± half-width for
 *  uniform — so both read identically on the card ("± spread"). */
export interface UncertaintySpec {
  kind: DistributionKind;
  spread: number;
}

export const DEFAULT_MC_SAMPLES = 500;
export const DEFAULT_MC_SEED = 1;

/** mulberry32 — a tiny, fast, well-distributed 32-bit seeded PRNG. Deterministic:
 *  the same seed yields the identical [0,1) sequence on every platform, which is
 *  exactly what makes a seeded Monte Carlo run reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One standard-normal draw via Box–Muller from a uniform [0,1) generator. */
export function sampleStandardNormal(rng: () => number): number {
  let u1 = rng();
  while (u1 <= Number.EPSILON) u1 = rng(); // guard log(0) = -Inf
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Draw one value for an uncertain input: normal(mean, spread) or
 *  uniform(mean−spread, mean+spread). A non-positive spread is a point value. */
export function sampleUncertain(mean: number, spec: UncertaintySpec, rng: () => number): number {
  if (!(spec.spread > 0) || !Number.isFinite(mean)) return mean;
  if (spec.kind === "uniform") return mean + (rng() * 2 - 1) * spec.spread;
  return mean + sampleStandardNormal(rng) * spec.spread;
}

/** Summarize numeric draws into an UncertainNumber (sample mean ± sample standard
 *  deviation), carrying the raw draws for a histogram. Unbiased (N−1) variance for
 *  N ≥ 2; a single draw has zero spread. Non-finite draws are dropped first so a
 *  per-iteration failure can't poison the summary. */
export function summarizeSamples(draws: readonly number[]): UncertainNumber {
  const nums = draws.filter((d) => Number.isFinite(d));
  const n = nums.length;
  if (n === 0) return uncertain(NaN, 0, []);
  const mean = nums.reduce((s, d) => s + d, 0) / n;
  if (n === 1) return uncertain(mean, 0, nums);
  const variance = nums.reduce((s, d) => s + (d - mean) * (d - mean), 0) / (n - 1);
  return uncertain(mean, Math.sqrt(variance), nums);
}

/** Bin a sample set into `bins` equal-width buckets over [min, max] — the shape a
 *  histogram renderer draws. Returns per-bin counts plus the bounds; an empty or
 *  zero-range set yields a single full bucket so the caller never divides by zero. */
export function histogram(samples: readonly number[], bins = 12): { counts: number[]; min: number; max: number } {
  const nums = samples.filter((d) => Number.isFinite(d));
  if (nums.length === 0) return { counts: [0], min: 0, max: 0 };
  let min = Infinity, max = -Infinity;
  for (const d of nums) { if (d < min) min = d; if (d > max) max = d; }
  if (min === max) return { counts: [nums.length], min, max };
  const b = Math.max(1, Math.floor(bins));
  const counts = new Array<number>(b).fill(0);
  const span = max - min;
  for (const d of nums) {
    let idx = Math.floor(((d - min) / span) * b);
    if (idx >= b) idx = b - 1; // the max value lands in the last bin
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  return { counts, min, max };
}
