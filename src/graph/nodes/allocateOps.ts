// [[C17]] shareImpl

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
  const alloc = mins.slice();
  const fixed = new Array<boolean>(n).fill(false);
  let fixedSum = 0;
  // Each pass fixes at least one category or finishes, so n + 1 passes always suffice.
  for (let pass = 0; pass <= n; pass++) {
    const free: number[] = [];
    for (let i = 0; i < n; i++) if (!fixed[i]) free.push(i);
    if (free.length === 0) break;
    const remaining = budget - fixedSum;
    const wFree = sum(free.map((i) => w[i]));
    const share = (i: number) => (wFree > 0 ? (remaining * w[i]) / wFree : remaining / free.length);
    let clamped = false;
    for (const i of free) {
      const t = share(i);
      if (t <= mins[i]) { alloc[i] = mins[i]; fixed[i] = true; fixedSum += mins[i]; clamped = true; }
      else if (t >= maxs[i]) { alloc[i] = maxs[i]; fixed[i] = true; fixedSum += maxs[i]; clamped = true; }
    }
    if (!clamped) { for (const i of free) alloc[i] = share(i); break; }
  }
  return alloc;
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
    if (vFull <= need) { alloc[i] = maxs[i]; need -= vFull; }
    else { alloc[i] += need / w[i]; need = 0; break; }
  }
  return alloc;
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
