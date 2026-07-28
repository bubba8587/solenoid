import { isSolError, type SolError } from "../errorValue";
import { forAggregate, isMissing } from "../valueKinds";
import { iterMin, iterMax } from "./mathUtils";

// ─── Pure list ops — ONE implementation per op, two surfaces ──────────────────
// The node's `data()` and the formula registration (D19 Tier 3) both call these, so
// `REVERSE(list)` in a formula and a REVERSE node cannot disagree. Same reason
// `textOps.ts` and `financeOps.ts` exist; `formulaTier3.test.ts` pins the equality.
//
// A separate module rather than list.ts because list.ts pulls in rete, the socket
// lattice and the frame model — none of which the headless formula path should load.
//
// VALUE MODEL: these are the list rung of the same contract the rest of the app runs
// (docs/value-semantics.md). A per-cell `null` is a real missing value and a per-cell
// SolError is a real error, so every op here says explicitly what it does with them
// rather than assuming a clean `number[]`.

export type Cell = number | null | SolError;

/** The first SolError anywhere in the list, or null. Element-wise ops carry a cell
 *  error through in place; whole-list reducers surface it instead of a number. */
export function firstError(arr: readonly unknown[]): SolError | null {
  for (const v of arr) if (isSolError(v)) return v;
  return null;
}

// ─── Shape: list in, list out ─────────────────────────────────────────────────
// Every one of these is POSITION-preserving, so a null stays a null in its slot
// (reversing [1,null,3] is [3,null,1], never [3,1]) and a cell error rides along.

export function reverseList<T>(arr: readonly T[]): T[] {
  return [...arr].reverse();
}

/** 1-based inclusive, matching the node's Start/End fields. `end === undefined`
 *  runs to the end of the list — the OMITTED reading, not a blank one. */
export function sliceList<T>(arr: readonly T[], start: number, end?: number): T[] {
  return arr.slice(Math.max(0, Math.round(start) - 1), end === undefined ? undefined : Math.round(end));
}

/** Every Nth element, counting from the first (n=1 is the identity). */
export function nthElement<T>(arr: readonly T[], n: number): T[] {
  const step = Math.max(1, Math.round(n));
  return arr.filter((_, i) => i % step === 0);
}

/** Ragged inputs pad to the LONGEST with null, so the A/B alternation stays aligned
 *  and no tail element is silently dropped. */
export function interleave<T>(a: readonly T[], b: readonly T[]): (T | null)[] {
  const n = Math.max(a.length, b.length);
  const out: (T | null)[] = [];
  for (let i = 0; i < n; i++) out.push(i < a.length ? a[i] : null, i < b.length ? b[i] : null);
  return out;
}

export type PadDir = "right" | "left";

export function padList<T>(arr: readonly T[], n: number, fill: T, dir: PadDir): T[] {
  const target = Math.round(n);
  if (arr.length >= target) return [...arr];
  const pad = Array<T>(target - arr.length).fill(fill);
  return dir === "left" ? [...pad, ...arr] : [...arr, ...pad];
}

/** Successive differences — one shorter than the input. */
export function diffList(arr: readonly number[]): number[] {
  return arr.slice(1).map((v, i) => v - arr[i]);
}

/** Rescale to 0–1 by the list's own min/max. A flat list is all zeros (the range is
 *  zero, so every element sits at the same place in it). */
export function normalizeList(arr: readonly number[]): number[] {
  if (arr.length === 0) return [];
  const mn = iterMin(arr), mx = iterMax(arr);
  return mn === mx ? arr.map(() => 0) : arr.map((v) => (v - mn) / (mx - mn));
}

export type CumulativeOp = "cumsum" | "cumprod" | "cummax" | "cummin";

export function cumulative(op: CumulativeOp, arr: readonly number[]): number[] {
  const out: number[] = [];
  let acc = op === "cumprod" ? 1 : 0;
  for (const v of arr) {
    switch (op) {
      case "cumsum":  acc = (out.length === 0 ? 0 : acc) + v; break;
      case "cummax":  acc = out.length === 0 ? v : Math.max(acc, v); break;
      case "cummin":  acc = out.length === 0 ? v : Math.min(acc, v); break;
      case "cumprod": acc = (out.length === 0 ? 1 : acc) * v; break;
    }
    out.push(acc);
  }
  return out;
}

export type RollingOp = "sum" | "avg" | "min" | "max" | "stdev" | "median";

/** Sliding window ending at each position (so the first cells run on a short window).
 *  Each window goes through `forAggregate` like every other reducer: a cell error
 *  propagates into THAT output cell, a null is SKIPPED rather than counted as zero.
 *  An all-null window is 0 for sum and null for everything else. */
export function rolling(op: RollingOp, arr: readonly Cell[], window: number): Cell[] {
  const w = Math.max(1, Math.round(window));
  return arr.map((_, i) => {
    const prep = forAggregate(arr.slice(Math.max(0, i - w + 1), i + 1));
    if (prep.error) return prep.error;
    const nums = prep.nums.filter((n) => Number.isFinite(n));
    if (nums.length === 0) return op === "sum" ? 0 : null;
    switch (op) {
      case "sum": return nums.reduce((a, b) => a + b, 0);
      case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
      case "min": return iterMin(nums);
      case "max": return iterMax(nums);
      case "stdev": {
        if (nums.length < 2) return null; // sample stdev undefined (matches var_s)
        const m = nums.reduce((a, b) => a + b, 0) / nums.length;
        return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / (nums.length - 1));
      }
      case "median": {
        const sorted = [...nums].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      }
    }
  });
}

// ─── Find: list in, scalar out ────────────────────────────────────────────────

export type ArgMinMaxOp = "argmax" | "argmin";

/** 1-based position of the extreme value; null for an empty list. */
export function argMinMax(op: ArgMinMaxOp, arr: readonly number[]): number | null {
  if (arr.length === 0) return null;
  let idx = 0;
  for (let i = 1; i < arr.length; i++) {
    if (op === "argmax" ? arr[i] > arr[idx] : arr[i] < arr[idx]) idx = i;
  }
  return idx + 1;
}

/** 1 / 0 rather than a logical, matching the node's numeric output socket. */
export function containsValue(arr: readonly unknown[], v: unknown): number {
  return arr.includes(v) ? 1 : 0;
}

// ─── Weighted statistics ──────────────────────────────────────────────────────

export type WeightedOp = "wavg" | "wvar" | "wstdev";

/** Values paired to weights BY POSITION; a pair is skipped when either side is
 *  missing. Variance is the Bessel-corrected reliability-weight form
 *  `Σw·(x−μ)² / (Σw − Σw²/Σw)`, which is what the node has always computed. */
export function weighted(op: WeightedOp, values: readonly Cell[], weights: readonly Cell[]): number | SolError | null {
  const err = firstError(values) ?? firstError(weights);
  if (err) return err;
  if (values.length === 0 || weights.length < values.length) return null;
  const pairs: [number, number][] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i], w = weights[i];
    if (!isMissing(v) && !isMissing(w)) pairs.push([v as number, w as number]);
  }
  const wSum = pairs.reduce((a, [, w]) => a + w, 0);
  if (pairs.length === 0 || wSum === 0) return null;
  const wavg = pairs.reduce((s, [v, w]) => s + v * w, 0) / wSum;
  let result: number | null = wavg;
  if (op !== "wavg") {
    const wSum2 = pairs.reduce((a, [, w]) => a + w * w, 0);
    const denom = wSum - wSum2 / wSum;
    result = null;
    if (denom > 0) {
      const wvar = pairs.reduce((s, [v, w]) => s + w * (v - wavg) ** 2, 0) / denom;
      result = op === "wvar" ? wvar : Math.sqrt(wvar);
    }
  }
  return result !== null && Number.isFinite(result) ? result : null;
}

// ─── Build: scalars in, list out ──────────────────────────────────────────────
// The generators themselves are UNCAPPED — a node's Count field is a spinner the
// user watches, and RANDARRAY/SEQUENCE already own the app's overflow convention
// (`#OVERFLOW!` past MAX_GENERATED). A formula field is the surface where a typo can
// ask for ten million elements with no visible control, so the registrations apply
// that same convention at the boundary rather than these silently truncating.

/** Shared with RANDARRAY / SEQUENCE — the app's one generated-length ceiling. */
export const MAX_GENERATED = 1_000_000;

export function linspace(start: number, end: number, count: number): number[] {
  const n = Math.round(count);
  if (n <= 0) return [];
  if (n === 1) return [start];
  return Array.from({ length: n }, (_, i) => start + i * (end - start) / (n - 1));
}

export function repeatValue<T>(value: T, count: number): T[] {
  return Array<T>(Math.max(0, Math.round(count))).fill(value);
}

export function geometric(start: number, ratio: number, count: number): number[] {
  const n = Math.max(0, Math.round(count));
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < n; i++) { out.push(v); v *= ratio; }
  return out;
}

/** Capped at 78 terms — the last Fibonacci number exactly representable as a double
 *  (F79 exceeds 2^53 and would silently start rounding). */
export function fibonacci(count: number): number[] {
  const n = Math.min(78, Math.max(0, Math.round(count)));
  if (n === 0) return [];
  const out = [1];
  if (n > 1) out.push(1);
  for (let i = 2; i < n; i++) out.push(out[i - 1] + out[i - 2]);
  return out;
}
