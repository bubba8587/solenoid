// [[D46]] freezeVolatilePerCalc

import { uncertain, type UncertainNumber } from "./valueKinds";
import { stdNormCDF } from "./nodes/mathUtils";

export type DistributionKind = "normal" | "uniform";

export interface UncertaintySpec {
  kind: DistributionKind;
  spread: number;
}

export const DEFAULT_MC_SAMPLES = 500;
export const DEFAULT_MC_SEED = 1;

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

export function sampleStandardNormal(rng: () => number): number {
  let u1 = rng();
  while (u1 <= Number.EPSILON) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function sampleUncertain(mean: number, spec: UncertaintySpec, rng: () => number): number {
  if (!(spec.spread > 0) || !Number.isFinite(mean)) return mean;
  if (spec.kind === "uniform") return mean + (rng() * 2 - 1) * spec.spread;
  return mean + sampleStandardNormal(rng) * spec.spread;
}

export function summarizeSamples(draws: readonly number[]): UncertainNumber {
  const nums = draws.filter((d) => Number.isFinite(d));
  const n = nums.length;
  const dropped = draws.length - n;
  const withDropped = (u: UncertainNumber): UncertainNumber => (dropped > 0 ? { ...u, dropped } : u);
  if (n === 0) return withDropped(uncertain(NaN, 0, []));
  const mean = nums.reduce((s, d) => s + d, 0) / n;
  if (n === 1) return withDropped(uncertain(mean, 0, nums));
  const variance = nums.reduce((s, d) => s + (d - mean) * (d - mean), 0) / (n - 1);
  return withDropped(uncertain(mean, Math.sqrt(variance), nums));
}

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
    if (idx >= b) idx = b - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  return { counts, min, max };
}

// ─── Correlated inputs ─────────────────────────────────────────────────────────

export interface CorrelationPair { a: string; b: string; rho: number }

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
