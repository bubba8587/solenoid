// Budget allocation across categories bounded by [min, max] price ranges, driven by
// value weights. Three closed-form modes, NO general solver:
//   • budget          — spend a fixed budget ∝ weight, clamped to each range, the residual
//                        from a clamp redistributed among the still-free categories (a
//                        deterministic water-filling fixed point).
//   • minTarget       — the least spend that reaches a weighted-value target Σwᵢaᵢ ≥ target:
//                        floor everything, then buy value cheapest-per-dollar (highest
//                        weight) first (fractional knapsack — greedy is exact here).
//   • minProportional — the least spend that keeps aᵢ ∝ wᵢ above the floors: scale up from
//                        the binding floor, k = maxᵢ(minᵢ/wᵢ), then clamp to max.
// Weights are read non-negative (a negative weight is treated as 0); an all-zero weight set
// falls back to equal weights so a mode still has something to divide by.

export type AllocateMode = "budget" | "minTarget" | "minProportional";

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const clampRange = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Non-negative weights; all-zero → equal weights (1 each) so a divide-by-Σw is safe. */
function readWeights(weights: readonly number[]): number[] {
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  return sum(w) > 0 ? w : weights.map(() => 1);
}

/** Spend `budget` ∝ weight, each clamped to [min,max]; a clamp's residual redistributes
 *  among the still-free categories, iterated to a fixed point. Below Σmin → all mins
 *  (can't afford the floors); above Σmax → all maxes (surplus can't be spent in range). */
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
  // Each pass fixes ≥ 1 category (or finishes), so ≤ n passes.
  for (let pass = 0; pass <= n; pass++) {
    const free: number[] = [];
    for (let i = 0; i < n; i++) if (!fixed[i]) free.push(i);
    if (free.length === 0) break;
    const remaining = budget - fixedSum;
    const wFree = sum(free.map((i) => w[i]));
    // A free block with no weight splits its share equally so it can still clamp/settle.
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

/** Least spend to reach a weighted-value target Σwᵢaᵢ ≥ target. Floors first, then buy
 *  the extra value from the highest-weight category (most value per dollar) up to its max,
 *  spilling to the next. Unreachable even at all maxes → best effort (returns those maxes). */
export function allocateMinTarget(
  mins: readonly number[], maxs: readonly number[], weights: readonly number[], target: number,
): number[] {
  const n = mins.length;
  const w = readWeights(weights);
  const alloc = mins.slice();
  let need = target - sum(alloc.map((a, i) => w[i] * a));
  if (need <= 0) return alloc;
  const order = [...Array(n).keys()].sort((a, b) => w[b] - w[a]); // highest weight first
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

/** Least spend keeping aᵢ ∝ wᵢ above the floors: k = maxᵢ(minᵢ/wᵢ), aᵢ = clamp(k·wᵢ).
 *  A zero-weight category can't be proportional to 0, so it takes its floor. */
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

/** Dispatch. `amount` is the budget (budget mode) or the value target (minTarget); ignored
 *  by minProportional. Ranges are normalized so a `min > max` row doesn't misbehave. */
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
