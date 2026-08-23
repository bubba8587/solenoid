// Seeded, deterministic Monte Carlo sampling, SCOPED to the composite subsystem — the
// app's only sampler.

import { uncertain, type UncertainNumber } from "./valueKinds";
import { stdNormCDF } from "./nodes/mathUtils";

export type DistributionKind = "normal" | "uniform";

/** `spread` is the marker's `uncertainty`: a 1σ for normal, a ± half-width for uniform,
 *  so both read identically on the card. */
export interface UncertaintySpec {
  kind: DistributionKind;
  spread: number;
}

export const DEFAULT_MC_SAMPLES = 500;
export const DEFAULT_MC_SEED = 1;

/** The same seed yields the identical [0,1) sequence on every platform, which is what
 *  makes a run reproducible. */
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

/** Mean ± sample sd, carrying the raw draws. Unbiased (N−1) variance for N ≥ 2; non-finite
 *  draws are dropped first so a per-iteration failure can't poison the summary. */
export function summarizeSamples(draws: readonly number[]): UncertainNumber {
  const nums = draws.filter((d) => Number.isFinite(d));
  const n = nums.length;
  if (n === 0) return uncertain(NaN, 0, []);
  const mean = nums.reduce((s, d) => s + d, 0) / n;
  if (n === 1) return uncertain(mean, 0, nums);
  const variance = nums.reduce((s, d) => s + (d - mean) * (d - mean), 0) / (n - 1);
  return uncertain(mean, Math.sqrt(variance), nums);
}

/** An empty or zero-range set yields a single full bucket, so the caller never divides
 *  by zero. */
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

// ─── Correlated inputs (@RISK / Crystal Ball "correlate assumptions") ──────────────
// A Gaussian copula: draw standard normals with the requested correlation (Cholesky of
// the matrix), map each to a uniform through Φ, then to its OWN marginal — so every
// input keeps exactly the distribution it declared and only the dependence changes.
// The entered number is the normal-score (Pearson) correlation; the Spearman rank
// correlation it induces is (6/π)·asin(ρ/2), within 2 % of ρ across the range.

export interface CorrelationPair { a: string; b: string; rho: number }

/** Parse the card's correlation text: `a ~ b = 0.7; c ~ d = -0.3` (`,` or `;` between
 *  pairs; labels or ids, resolved by the caller). Out-of-range or malformed entries are
 *  dropped and reported in `rejected`. */
export function parseCorrelations(text: string): { pairs: CorrelationPair[]; rejected: string[] } {
  const pairs: CorrelationPair[] = [], rejected: string[] = [];
  for (const raw of text.split(/[;,]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(.+?)\s*~\s*(.+?)\s*=\s*(-?\d*\.?\d+)$/.exec(part);
    const rho = m ? Number(m[3]) : NaN;
    if (!m || !(rho >= -1 && rho <= 1) || m[1].trim() === m[2].trim()) { rejected.push(part); continue; }
    pairs.push({ a: m[1].trim(), b: m[2].trim(), rho });
  }
  return { pairs, rejected };
}

/** Build the k×k correlation matrix for the ports in `ids` order (1 on the diagonal,
 *  the given pairs elsewhere, 0 otherwise) and make it positive-definite by shrinking
 *  the off-diagonals toward 0 until Cholesky succeeds (an inconsistent set is softened,
 *  never refused). Returns the Cholesky factor L (R = L·Lᵀ). */
export function correlationCholesky(ids: readonly string[], pairs: readonly CorrelationPair[]): number[][] {
  const k = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const base: number[][] = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)));
  for (const p of pairs) {
    const i = idx.get(p.a), j = idx.get(p.b);
    if (i === undefined || j === undefined || i === j) continue;
    base[i][j] = p.rho; base[j][i] = p.rho;
  }
  for (let shrink = 1; shrink >= 0; shrink -= 0.05) {
    const Rm = base.map((row, i) => row.map((v, j) => (i === j ? 1 : v * shrink)));
    const L = cholesky(Rm);
    if (L) return L;
  }
  return Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)));
}

function cholesky(A: number[][]): number[][] | null {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) { if (sum <= 1e-12) return null; L[i][j] = Math.sqrt(sum); }
      else L[i][j] = sum / L[j][j];
    }
  }
  return L;
}

/** One correlated draw per spec (in `specs` order): correlated standard normals through
 *  the Cholesky factor, each mapped onto its own marginal. A non-positive spread is a point. */
export function sampleCorrelated(
  specs: ReadonlyArray<{ mean: number; spec: UncertaintySpec }>,
  L: number[][],
  rng: () => number,
): number[] {
  const k = specs.length;
  const eps = Array.from({ length: k }, () => sampleStandardNormal(rng));
  const z = Array.from({ length: k }, (_, i) => { let v = 0; for (let j = 0; j <= i; j++) v += L[i][j] * eps[j]; return v; });
  return specs.map(({ mean, spec }, i) => {
    if (!(spec.spread > 0) || !Number.isFinite(mean)) return mean;
    if (spec.kind === "uniform") return mean + (2 * stdNormCDF(z[i]) - 1) * spec.spread;
    return mean + z[i] * spec.spread;
  });
}
