import { isSolError, type SolError } from "../errorValue";
import { isCx } from "../cxValue";
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

/** Successive differences — one shorter than the input. Element-wise over
 *  consecutive PAIRS: a missing neighbour makes that difference missing, and a
 *  cell error propagates into each difference it touches — bare arithmetic here
 *  once computed `v - null` as `v - 0` and string-concatenated a SolError. */
export function diffList(arr: readonly Cell[]): Cell[] {
  return arr.slice(1).map((v, i) => {
    const prev = arr[i];
    if (isSolError(v)) return v;
    if (isSolError(prev)) return prev;
    if (isMissing(v) || isMissing(prev)) return null;
    return (v as number) - (prev as number);
  });
}

/** Rescale to 0–1 by the list's own min/max. A flat list is all zeros (the range is
 *  zero, so every element sits at the same place in it). The SCALE is a reduction —
 *  an error anywhere poisons it, a null is skipped for it and stays null in place. */
export function normalizeList(arr: readonly Cell[]): Cell[] | SolError {
  const err = firstError(arr);
  if (err) return err;
  const nums = presentNumbers(arr);
  if (nums.length === 0) return arr.map(() => null);
  const mn = iterMin(nums), mx = iterMax(nums);
  return arr.map((v) =>
    typeof v === "number" && Number.isFinite(v) ? (mn === mx ? 0 : (v - mn) / (mx - mn)) : null);
}

export type CumulativeOp = "cumsum" | "cumprod" | "cummax" | "cummin";

/** Running aggregate with the reducer policy applied per PREFIX: a null cell
 *  contributes nothing (its output is the running value so far — null while
 *  nothing has been seen), and a cell error poisons its own position and every
 *  later one, since each later prefix contains it. Bare arithmetic here once made
 *  RUNNINGMAX([-5, null]) answer [-5, 0] via Math.max(-5, null). */
export function cumulative(op: CumulativeOp, arr: readonly Cell[]): Cell[] {
  const out: Cell[] = [];
  let err: SolError | null = null;
  let acc: number | null = null;
  for (const v of arr) {
    if (err) { out.push(err); continue; }
    if (isSolError(v)) { err = v; out.push(v); continue; }
    if (isMissing(v) || typeof v !== "number") { out.push(acc); continue; }
    if (acc === null) acc = v;
    else {
      switch (op) {
        case "cumsum":  acc = acc + v; break;
        case "cummax":  acc = Math.max(acc, v); break;
        case "cummin":  acc = Math.min(acc, v); break;
        case "cumprod": acc = acc * v; break;
      }
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

/** 1-based position of the extreme value; null for an empty (or all-missing)
 *  list. Reducer policy: a cell error propagates, a null is skipped — the bare
 *  comparison once let `null` compare as 0 and win argmin. */
export function argMinMax(op: ArgMinMaxOp, arr: readonly Cell[]): number | SolError | null {
  const err = firstError(arr);
  if (err) return err;
  let idx = -1;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (idx === -1 || (op === "argmax" ? v > (arr[idx] as number) : v < (arr[idx] as number))) idx = i;
  }
  return idx === -1 ? null : idx + 1;
}

/** 1 / 0 rather than a logical, matching the node's numeric output socket.
 *  Membership keys by VALUE via setKey (VAL-8 — `includes` compares a complex
 *  [re, im] tuple by reference and never matched); blank and error cells are not
 *  members, exactly as the Set family treats them. */
export function containsValue(arr: readonly unknown[], v: unknown): number {
  const k = setKey(v);
  return arr.some((x) => !isMissing(x) && !isSolError(x) && setKey(x) === k) ? 1 : 0;
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

/** SEQUENCE's arithmetic core (Excel: SEQUENCE). Uncapped — both surfaces apply
 *  the MAX_GENERATED overflow convention at their own boundary. */
export function sequenceList(count: number, start: number, step: number): number[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => start + i * step);
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

// ─── Sets ─────────────────────────────────────────────────────────────────────
// Membership is by VALUE, not identity (VAL-8). JS Sets key OBJECTS by reference, so
// a tagged complex (VAL-15) canonicalizes to a string; every primitive (number incl.
// a date serial, string, boolean) stays itself. Precise now: only a complex takes the
// detour — the old Array.isArray branch swept up ANY array cell.
export function setKey(v: unknown): unknown {
  return isCx(v) ? `\x00cx:${v.re},${v.im}` : v;
}

/** A side's distinct members. Blank (null) and error cells are NOT members — they
 *  can't be equal to anything, so they take no part in the comparison. */
function memberSet(arr: readonly unknown[]): Set<unknown> {
  const s = new Set<unknown>();
  for (const v of arr) if (!isMissing(v) && !isSolError(v)) s.add(setKey(v));
  return s;
}

export type SetOp = "union" | "intersect" | "difference" | "symdiff";

/** First-seen order, deduped the way UNIQUE does. An error cell is never equal to
 *  anything, so it can't match across sides: it passes through where it belongs
 *  (kept in union, and on the A side of difference / symmetric difference; dropped
 *  from intersection) rather than silently vanishing. */
export function setOperation(op: SetOp, a: readonly unknown[], b: readonly unknown[]): unknown[] {
  const aSet = memberSet(a), bSet = memberSet(b);
  const out: unknown[] = [];
  const emitted = new Set<unknown>();
  const emitValue = (v: unknown) => { const k = setKey(v); if (!emitted.has(k)) { emitted.add(k); out.push(v); } };
  switch (op) {
    case "union":
      for (const v of a) { if (isMissing(v)) continue; if (isSolError(v)) out.push(v); else emitValue(v); }
      for (const v of b) { if (isMissing(v)) continue; if (isSolError(v)) out.push(v); else emitValue(v); }
      break;
    case "intersect":
      for (const v of a) { if (isMissing(v) || isSolError(v)) continue; if (bSet.has(setKey(v))) emitValue(v); }
      break;
    case "difference":
      for (const v of a) { if (isMissing(v)) continue; if (isSolError(v)) out.push(v); else if (!bSet.has(setKey(v))) emitValue(v); }
      break;
    case "symdiff":
      for (const v of a) { if (isMissing(v)) continue; if (isSolError(v)) out.push(v); else if (!bSet.has(setKey(v))) emitValue(v); }
      for (const v of b) { if (isMissing(v)) continue; if (isSolError(v)) out.push(v); else if (!aSet.has(setKey(v))) emitValue(v); }
      break;
  }
  return out;
}

export type SetRelation = "equal" | "subset" | "superset" | "disjoint";

/** The empty-set edge cases follow set theory: ∅ ⊆ anything, ∅ is disjoint with
 *  anything, ∅ = ∅. */
export function setRelation(op: SetRelation, a: readonly unknown[], b: readonly unknown[]): boolean {
  const aSet = memberSet(a), bSet = memberSet(b);
  const subsetOf = (x: Set<unknown>, y: Set<unknown>) => {
    for (const v of x) if (!y.has(v)) return false;
    return true;
  };
  switch (op) {
    case "equal":    return aSet.size === bSet.size && subsetOf(aSet, bSet);
    case "subset":   return subsetOf(aSet, bSet);
    case "superset": return subsetOf(bSet, aSet);
    case "disjoint": {
      for (const v of aSet) if (bSet.has(v)) return false;
      return true;
    }
  }
}

// ─── Fill / Coalesce — the opt-in to treat a missing as something ──────────────

export type FillOp =
  | "constant" | "ffill" | "bfill" | "mean" | "median" | "mode"
  | "interpolate" | "drop" | "coalesce";

/** Present finite numbers only — gaps and per-cell errors excluded, so an imputed
 *  statistic is computed from the values that are actually there. */
export function presentNumbers(arr: readonly Cell[]): number[] {
  return arr.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

export function imputeStat(arr: readonly Cell[], op: "mean" | "median" | "mode"): number | null {
  const nums = presentNumbers(arr);
  if (nums.length === 0) return null; // nothing present → can't impute, leave gaps null
  if (op === "mean") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (op === "median") {
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  }
  // mode: most frequent; ties broken by first occurrence (Excel MODE behavior).
  const counts = new Map<number, number>();
  let best = nums[0], bestCount = 0;
  for (const v of nums) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) { bestCount = c; best = v; }
  }
  return best;
}

/** Linear interpolation of INTERIOR gaps only. An open-ended run (leading/trailing)
 *  or one bounded by an error has nothing to interpolate between, so its nulls stay. */
export function interpolateList(arr: readonly Cell[]): Cell[] {
  const out: Cell[] = arr.slice();
  let i = 0;
  while (i < out.length) {
    if (!isMissing(out[i])) { i++; continue; }
    const start = i;
    while (i < out.length && isMissing(out[i])) i++;
    const end = i, left = start - 1, right = end;
    const lv = left >= 0 ? out[left] : undefined;
    const rv = right < out.length ? out[right] : undefined;
    if (typeof lv === "number" && Number.isFinite(lv) && typeof rv === "number" && Number.isFinite(rv)) {
      const span = right - left;
      for (let k = start; k < end; k++) out[k] = lv + (rv - lv) * ((k - left) / span);
    }
  }
  return out;
}

/** `constant` supplies the fill for the constant op; `fallbacks` are coalesce's
 *  ordered sources — a LIST extends the output to its length, a bare number is a
 *  broadcast constant that doesn't extend, and null contributes nothing. */
export function fillList(
  op: FillOp,
  arr: readonly Cell[],
  opts: { constant?: Cell; fallbacks?: readonly (Cell[] | number | null)[] } = {},
): Cell[] {
  switch (op) {
    case "constant": {
      const c = opts.constant ?? null;
      return arr.map((v) => (isMissing(v) ? c : v));
    }
    case "ffill": {
      const out: Cell[] = [];
      let last: Cell = null, have = false;
      for (const v of arr) {
        if (isMissing(v)) out.push(have ? last : null);
        else { last = v; have = true; out.push(v); }
      }
      return out;
    }
    case "bfill": {
      const out = new Array<Cell>(arr.length).fill(null);
      let next: Cell = null, have = false;
      for (let i = arr.length - 1; i >= 0; i--) {
        const v = arr[i];
        if (isMissing(v)) out[i] = have ? next : null;
        else { next = v; have = true; out[i] = v; }
      }
      return out;
    }
    case "mean": case "median": case "mode": {
      const stat = imputeStat(arr, op);
      return arr.map((v) => (isMissing(v) ? stat : v));
    }
    case "interpolate": return interpolateList(arr);
    case "drop":        return arr.filter((v) => !isMissing(v));
    case "coalesce": {
      const fallbacks = opts.fallbacks ?? [];
      const lists = fallbacks.filter((f): f is Cell[] => Array.isArray(f));
      const n = Math.max(arr.length, ...lists.map((s) => s.length), 0);
      return Array.from({ length: n }, (_, i): Cell => {
        const first: Cell = i < arr.length ? arr[i] : null;
        if (!isMissing(first)) return first;
        for (const f of fallbacks) {
          if (f === null) continue;
          const v: Cell = typeof f === "number" ? f : i < f.length ? f[i] : null;
          if (!isMissing(v)) return v;
        }
        return null;
      });
    }
  }
}

// ─── Range ────────────────────────────────────────────────────────────────────

/** Half-open `[start, stop)` walking by `step`, like Python's range. An UNSET stop
 *  (undefined) means no series yet — that is the node's empty card, not a blank
 *  cable (value-semantics.md, "absent is not unknown").
 *
 *  The IMPLIED length, for the shared overflow convention: unlike the other
 *  generators there is no Count field, so callers cap on this rather than on an
 *  argument. Infinity when the walk never terminates (step 0 or wrong-signed). */
export function rangeCount(start: number, stop: number | undefined, step: number): number {
  if (stop === undefined) return 0;
  if (step === 0) return start === stop ? 0 : Infinity;
  const n = Math.ceil((stop - start) / step);
  return n > 0 ? n : 0;
}

export function rangeList(start: number, stop: number | undefined, step: number): number[] {
  const n = rangeCount(start, stop, step);
  if (!Number.isFinite(n)) return [];
  const out: number[] = [];
  let cur = start;
  for (let i = 0; i < n; i++) { out.push(cur); cur += step; }
  return out;
}

/** End-to-end concatenation, staying 1-D. An unwired row contributes nothing. */
export function concatLists(...lists: (readonly unknown[] | null | undefined)[]): unknown[] {
  const out: unknown[] = [];
  for (const l of lists) if (l != null) out.push(...l);
  return out;
}

// ─── Shuffle ──────────────────────────────────────────────────────────────────

/** Permute by SORT KEYS supplied by the caller — the pure part, with the volatility
 *  left outside it. That split is the whole point: the node holds one key per slot
 *  until the next recalc, so an unrelated edit doesn't reshuffle the card you are
 *  looking at, while a formula generates fresh keys per evaluation the way RAND and
 *  RANDBETWEEN already do. Same permutation code, two volatility policies. */
export function shuffleList<T>(arr: readonly T[], keys: readonly number[]): T[] {
  return arr
    .map((v, i) => ({ v, k: keys[i] }))
    .sort((a, b) => a.k - b.k)
    .map((p) => p.v);
}
