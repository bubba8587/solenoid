// [[C17]] shareImpl
import { solError } from "../errorValue";

export type AllocateMode = "budget" | "minTarget" | "minProportional";

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const clampRange = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function readWeights(weights: readonly number[]): number[] {
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  return sum(w) > 0 ? w : weights.map(() => 1);
}

export function allocateBudget(
  mins: readonly number[], maxs: readonly number[], weights: readonly number[], budget: number,
): number[] {
  const n = mins.length;
  if (budget <= sum(mins)) return mins.slice();
  if (budget >= sum(maxs)) return maxs.slice();
  const w = readWeights(weights);
  const at = (lambda: number) => mins.map((m, i) => (w[i] > 0 ? clampRange(lambda * w[i], m, maxs[i]) : m));
  const breaks = [...new Set(mins.flatMap((m, i) => (w[i] > 0 ? [m / w[i], maxs[i] / w[i]] : [])))].sort((a, b) => a - b);
  const k = breaks.findIndex((b) => sum(at(b)) >= budget);
  if (k < 0) {
    const zero = [...Array(n).keys()].filter((i) => w[i] === 0);
    const rest = allocateBudget(zero.map((i) => mins[i]), zero.map((i) => maxs[i]), zero.map(() => 1), budget - sum(at(Infinity)));
    const alloc = at(Infinity);
    zero.forEach((i, j) => { alloc[i] = rest[j]; });
    return alloc;
  }
  // S(λ) = Σ clamp(λ·w, min, max) is linear between breakpoints, so λ solves exactly on the bracketing segment.
  const mid = (breaks[k - 1] + breaks[k]) / 2;
  let fixedSum = 0, freeW = 0;
  for (let i = 0; i < n; i++) {
    const t = w[i] * mid;
    if (w[i] === 0 || t <= mins[i]) fixedSum += mins[i];
    else if (t >= maxs[i]) fixedSum += maxs[i];
    else freeW += w[i];
  }
  return at((budget - fixedSum) / freeW);
}

export function allocateMinTarget(
  mins: readonly number[], maxs: readonly number[], weights: readonly number[], target: number,
): number[] {
  const n = mins.length;
  const w = readWeights(weights);
  const alloc = mins.slice();
  let need = target - sum(alloc.map((a, i) => w[i] * a));
  if (need <= 0) return alloc;
  const order = [...Array(n).keys()].sort((a, b) => w[b] - w[a]);
  for (const i of order) {
    if (w[i] <= 0) continue;
    const headroom = maxs[i] - alloc[i];
    if (headroom <= 0) continue;
    const vFull = w[i] * headroom;
    if (vFull < need) { alloc[i] = maxs[i]; need -= vFull; }
    else { alloc[i] += need / w[i]; return alloc; }
  }
  const most = sum(maxs.map((m, i) => w[i] * m));
  throw solError("#VALUE!", `The target is out of reach: the most is ${+most.toPrecision(12)}`);
}

export function allocateProportional(
  mins: readonly number[], maxs: readonly number[], weights: readonly number[],
): number[] {
  const n = mins.length;
  const w = readWeights(weights);
  let k = 0;
  for (let i = 0; i < n; i++) if (w[i] > 0) k = Math.max(k, mins[i] / w[i]);
  const alloc: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = w[i] > 0 ? k * w[i] : mins[i];
    alloc.push(clampRange(t, mins[i], maxs[i]));
  }
  return alloc;
}

export function allocate(
  mode: AllocateMode, mins: readonly number[], maxs: readonly number[], weights: readonly number[], amount: number,
): number[] {
  const lo = mins.map((m, i) => Math.min(m, maxs[i]));
  const hi = maxs.map((m, i) => Math.max(m, mins[i]));
  switch (mode) {
    case "budget":          return allocateBudget(lo, hi, weights, amount);
    case "minTarget":       return allocateMinTarget(lo, hi, weights, amount);
    case "minProportional": return allocateProportional(lo, hi, weights);
  }
}
