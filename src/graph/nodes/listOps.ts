import { isSolError, solError, type SolError } from "../errorValue";
import { isCx } from "../cxValue";
import { forAggregate, isMissing } from "../valueKinds";
import { iterMin, iterMax } from "./mathUtils";

// ONE implementation per list op, called by both the node's `data()` and the formula
// registration, so the two surfaces cannot disagree. Kept out of list.ts, which pulls in rete.

export type Cell = number | null | SolError;

/** The first SolError anywhere in the list, or null. Element-wise ops carry a cell
 *  error through in place; whole-list reducers surface it instead of a number. */
export function firstError(arr: readonly unknown[]): SolError | null {
  for (const v of arr) if (isSolError(v)) return v;
  return null;
}

// ─── Shape: list in, list out ─────────────────────────────────────────────────
// All POSITION-preserving: a null stays a null in its slot and a cell error rides along.

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

/** Successive differences, one shorter than the input; a missing neighbour makes that
*  difference missing and a cell error propagates into each difference it touches. */
export function diffList(arr: readonly Cell[]): Cell[] {
  return arr.slice(1).map((v, i) => {
    const prev = arr[i];
    if (isSolError(v)) return v;
    if (isSolError(prev)) return prev;
    if (isMissing(v) || isMissing(prev)) return null;
    return (v as number) - (prev as number);
  });
}

/** Rescale to 0–1 by the list's own min/max (a flat list is all zeros). The SCALE is a
 *  reduction: an error anywhere poisons it, a null is skipped and stays null in place. */
export function normalizeList(arr: readonly Cell[]): Cell[] | SolError {
  const err = firstError(arr);
  if (err) return err;
  const nums = presentNumbers(arr);
  if (nums.length === 0) return arr.map(() => null);
  const mn = iterMin(nums), mx = iterMax(nums);
  return arr.map((v) =>
    typeof v === "number" && Number.isFinite(v) ? (mn === mx ? 0 : (v - mn) / (mx - mn)) : null);
}


/** Slide every element k places (k > 0 = later, toward the end). Vacated slots are
 *  blank; `wrap` fills them from the elements that fell off the other end (numpy.roll). */
export function shiftList(arr: readonly Cell[], k: number, wrap: boolean): Cell[] {
  const n = arr.length;
  if (n === 0) return [];
  const s = Math.round(k);
  if (wrap) {
    const m = ((s % n) + n) % n;
    return arr.map((_, i) => arr[(i - m + n) % n]);
  }
  return arr.map((_, i) => {
    const j = i - s;
    return j >= 0 && j < n ? arr[j] : null;
  });
}

/** Consecutive percent change (x[i] − x[i−1]) / x[i−1], one shorter than the input; a
 *  missing neighbour makes that entry blank, a zero base is #DIV/0!, an error propagates. */
export function pctChangeList(arr: readonly Cell[]): Cell[] {
  return arr.slice(1).map((v, i) => {
    const prev = arr[i];
    if (isSolError(v)) return v;
    if (isSolError(prev)) return prev;
    if (isMissing(v) || isMissing(prev)) return null;
    if ((prev as number) === 0) return solError("#DIV/0!", "Percent change from zero is undefined");
    return ((v as number) - (prev as number)) / (prev as number);
  });
}

/** Standardize to z-scores (x − mean) / stdev, population stdev; a flat list → all
 *  zeros. Like normalizeList, the reduction poisons on any error and skips nulls. */
export function zscoreList(arr: readonly Cell[]): Cell[] | SolError {
  const err = firstError(arr);
  if (err) return err;
  const nums = presentNumbers(arr);
  if (nums.length === 0) return arr.map(() => null);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
  return arr.map((v) =>
    typeof v === "number" && Number.isFinite(v) ? (sd === 0 ? 0 : (v - mean) / sd) : null);
}

/** Which half-open bin each value falls in: the count of breakpoints ≤ the value
 *  (0 = below the first break, so n breaks give bins 0..n). R findInterval / numpy.digitize. */
export function binIndex(arr: readonly Cell[], breaks: readonly Cell[]): Cell[] {
  const edges = presentNumbers(breaks).slice().sort((a, b) => a - b);
  return arr.map((v) => {
    if (isSolError(v)) return v;
    if (!(typeof v === "number" && Number.isFinite(v))) return null;
    let lo = 0, hi = edges.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (edges[m] <= v) lo = m + 1; else hi = m; }
    return lo;
  });
}

/** All k-length combinations (order-independent) or permutations (ordered) of a list,
 *  each returned as one row — itertools.combinations / permutations. Capped: the count is
 *  computed first (multiplicatively, no factorial overflow) and an explosive request is
 *  refused with #NUM! rather than generating an enormous table. */
const COMBO_CAP = 10_000;
export function combinationsOf(arr: readonly Cell[], k: number, kind: "combinations" | "permutations"): Cell[][] | SolError {
  const n = arr.length;
  const kk = Math.round(k);
  if (kk < 0) return solError("#VALUE!", "Choose count must be zero or more");
  if (kk > n) return []; // can't pick more than the list holds
  let count = 1;
  if (kind === "combinations") for (let i = 0; i < kk; i++) count = (count * (n - i)) / (i + 1);
  else for (let i = 0; i < kk; i++) count *= n - i;
  count = Math.round(count);
  if (count > COMBO_CAP) return solError("#OVERFLOW!", `That makes ${count} ${kind} — over the ${COMBO_CAP} cap. Use a shorter list or a smaller k.`);
  const out: Cell[][] = [];
  const cur: Cell[] = [];
  if (kind === "combinations") {
    const rec = (start: number): void => {
      if (cur.length === kk) { out.push(cur.slice()); return; }
      for (let i = start; i < n; i++) { cur.push(arr[i]); rec(i + 1); cur.pop(); }
    };
    rec(0);
  } else {
    const used = new Array<boolean>(n).fill(false);
    const rec = (): void => {
      if (cur.length === kk) { out.push(cur.slice()); return; }
      for (let i = 0; i < n; i++) { if (used[i]) continue; used[i] = true; cur.push(arr[i]); rec(); cur.pop(); used[i] = false; }
    };
    rec();
  }
  return out;
}

export type RunningOp = "sum" | "avg" | "min" | "max" | "median" | "product" | "stdev";

/** One aggregate per element over the window ending there: every element so far
 *  (window null; the window GROWS) or the last N (the window SLIDES, running short at
 *  the start). Per window: an error propagates to that cell and every later cell it
 *  stays in reach of, a null is SKIPPED, and an all-null window is 0 for sum and null
 *  otherwise. */
export function running(op: RunningOp, arr: readonly Cell[], window: number | null): Cell[] {
  if (window !== null) {
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
        case "product": return nums.reduce((a, b) => a * b, 1);
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
  // The grow path streams in one pass (a slice recompute would be O(n²)); it must
  // answer exactly what the slice path would with window = arr.length.
  let err: SolError | null = null;
  let count = 0, sum = 0, product = 1, mn = Infinity, mx = -Infinity;
  let mean = 0, m2 = 0;        // Welford, for stdev
  const sorted: number[] = []; // for median
  return arr.map((v) => {
    if (!err && isSolError(v)) err = v;
    if (err) return err;
    if (typeof v === "number" && Number.isFinite(v)) {
      count++; sum += v; product *= v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      const d = v - mean;
      mean += d / count;
      m2 += d * (v - mean);
      if (op === "median") {
        let lo = 0, hi = sorted.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (sorted[mid] < v) lo = mid + 1; else hi = mid;
        }
        sorted.splice(lo, 0, v);
      }
    }
    if (count === 0) return op === "sum" ? 0 : null;
    switch (op) {
      case "sum": return sum;
      case "avg": return sum / count;
      case "min": return mn;
      case "max": return mx;
      case "product": return product;
      case "stdev": return count < 2 ? null : Math.sqrt(m2 / (count - 1));
      case "median": {
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      }
    }
  });
}

// ─── Find: list in, scalar out ────────────────────────────────────────────────

export type ArgMinMaxOp = "argmax" | "argmin";

/** 1-based position of the extreme value; null for an empty or all-missing list, with the
*  usual reducer policy (error propagates, null skipped). */
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

export type XMatchMatchMode = "exact" | "next_larger" | "next_smaller";
export type XMatchSearchMode = "first" | "last";

/** Excel's lookup equality: text compares case-insensitively (EXACT is the
 *  case-sensitive escape hatch), everything else strictly. */
export function lookupEq(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** XMATCH over a 1-D list — the kernel behind the XMATCH node and the
 *  XLOOKUP/XMATCH formulas, so the surfaces can't drift. Returns the 0-based
 *  index of the winning cell, or −1 for a miss. Null and error cells never match
 *  (the join-key rule; a positional caller keeps errors IN PLACE, so an
 *  unreferenced error must not decide the answer). Approximate modes mirror the
 *  frame kernel (lookupFrameRowIndex): an exact hit always wins, else the closest
 *  ≤/≥ NUMERIC key — so they need a numeric lookup value. `searchMode` sets the
 *  scan direction, i.e. which DUPLICATE wins; ties in an approximate best keep
 *  the first seen in scan order. */
export function xmatchIndex(
  lookup: unknown, keys: readonly unknown[],
  matchMode: XMatchMatchMode = "exact", searchMode: XMatchSearchMode = "first",
): number | SolError {
  const n = keys.length;
  const at = (s: number) => (searchMode === "last" ? n - 1 - s : s);
  if (matchMode === "exact") {
    for (let s = 0; s < n; s++) {
      const i = at(s);
      const k = keys[i];
      if (k === null || isSolError(k)) continue;
      if (lookupEq(k, lookup)) return i;
    }
    return -1;
  }
  if (typeof lookup !== "number" || !Number.isFinite(lookup)) {
    return solError("#VALUE!", "Approximate match compares numbers — use exact match (0) for text");
  }
  let bestIdx = -1, bestKey = NaN;
  for (let s = 0; s < n; s++) {
    const i = at(s);
    const k = keys[i];
    if (typeof k !== "number" || !Number.isFinite(k)) continue;
    if (k === lookup) return i; // an exact hit always wins, first in scan order
    if (matchMode === "next_smaller" && k < lookup && (bestIdx === -1 || k > bestKey)) { bestIdx = i; bestKey = k; }
    if (matchMode === "next_larger"  && k > lookup && (bestIdx === -1 || k < bestKey)) { bestIdx = i; bestKey = k; }
  }
  return bestIdx;
}

/** 1 / 0 rather than a logical, matching the node's numeric output socket. Membership keys
*  by VALUE (setKey, keyByValue); blank and error cells are not members. */
export function containsValue(arr: readonly unknown[], v: unknown): boolean {
  const k = setKey(v);
  return arr.some((x) => !isMissing(x) && !isSolError(x) && setKey(x) === k);
}

// ─── Weighted statistics ──────────────────────────────────────────────────────

export type WeightedOp = "wavg" | "wvar" | "wstdev";

/** Values paired to weights BY POSITION, skipping a pair when either side is missing.
*  Variance is the Bessel-corrected reliability-weight form `Σw·(x−μ)² / (Σw − Σw²/Σw)`. */
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
// UNCAPPED here — each surface applies the `#OVERFLOW!` / MAX_GENERATED convention at its
// own boundary rather than these silently truncating.

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

/** SEQUENCE's arithmetic core; uncapped — each surface applies MAX_GENERATED itself. */
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
// Membership is by VALUE (keyByValue), but JS Sets key OBJECTS by reference, so only a tagged
// complex (tagSpecialScalars) canonicalizes to a string; primitives stay themselves.
export function setKey(v: unknown): unknown {
  return isCx(v) ? `\x00cx:${v.re},${v.im}` : v;
}

/** A side's distinct members; blank and error cells can't be equal to anything, so they
 *  are NOT members. */
function memberSet(arr: readonly unknown[]): Set<unknown> {
  const s = new Set<unknown>();
  for (const v of arr) if (!isMissing(v) && !isSolError(v)) s.add(setKey(v));
  return s;
}

export type SetOp = "union" | "intersect" | "difference" | "symdiff";

/** First-seen order, deduped the way UNIQUE does. An error cell matches nothing, so it
 *  passes through where it belongs rather than silently vanishing. */
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

/** Present finite numbers only, so an imputed statistic uses the values actually there. */
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

/** INTERIOR gaps only — an open-ended run, or one bounded by an error, has nothing to
 *  interpolate between, so its nulls stay. */
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

/** `fallbacks` are coalesce's ordered sources: a LIST extends the output to its length, a
 *  bare number broadcasts without extending, and null contributes nothing. */
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

/** Half-open `[start, stop)`; an UNSET stop means no series yet, not a blank cable. The
 *  returned length is what callers cap on (there is no Count field), and is Infinity when
 *  the walk never terminates. */
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

/** Permute by caller-supplied SORT KEYS, leaving volatility outside: the node holds keys
 *  until the next recalc, a formula generates fresh ones per evaluation. */
export function shuffleList<T>(arr: readonly T[], keys: readonly number[]): T[] {
  return arr
    .map((v, i) => ({ v, k: keys[i] }))
    .sort((a, b) => a.k - b.k)
    .map((p) => p.v);
}

// ─── matricesInFormulas tranche 2: the array-returning core ──────────────────────────────────

/** UNIQUE: first-seen dedupe by VALUE (setKey, keyByValue); every ERROR cell survives, so the
 *  count of errors to fix is deterministic. */
export function uniqueList(arr: readonly unknown[]): unknown[] {
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const v of arr) {
    if (isSolError(v)) { out.push(v); continue; }
    const k = setKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** SORT: numeric, stable; nulls and per-cell errors sort LAST in both directions — a bare
 *  compare would coerce null to 0 and scatter them mid-list. */
export function sortNumericList(arr: readonly Cell[], desc = false): Cell[] {
  const isTail = (v: unknown) => isMissing(v) || isSolError(v);
  const idx = arr.map((_, i) => i);
  idx.sort((i, j) => {
    const ti = isTail(arr[i]), tj = isTail(arr[j]);
    if (ti || tj) return ti && tj ? i - j : ti ? 1 : -1; // tail last, stable
    const c = (arr[i] as number) - (arr[j] as number);
    return c !== 0 ? (desc ? -c : c) : i - j; // stable on ties
  });
  return idx.map((i) => arr[i]);
}

/** SORTBY: reorder `arr` by parallel numeric keys; ragged pads to the LONGEST with
 *  null; a null/error KEY sends its row to the tail, stably. */
export function sortByKeys<T>(arr: readonly T[], by: readonly Cell[]): (T | null)[] {
  const n = Math.max(arr.length, by.length);
  const isTail = (v: unknown) => isMissing(v) || isSolError(v);
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((i, j) => {
    const ki = i < by.length ? by[i] : null, kj = j < by.length ? by[j] : null;
    const ti = isTail(ki), tj = isTail(kj);
    if (ti || tj) return ti && tj ? i - j : ti ? 1 : -1;
    const c = (ki as number) - (kj as number);
    return c !== 0 ? c : i - j;
  });
  return idx.map((i) => (i < arr.length ? arr[i] : null));
}

/** TAKE/DROP's signed count slice (positive from the start, negative from the end, 0 =
 *  identity). ONE kernel for the 1-D nodes, the 2-D node per axis, and the formula. */
export function takeSlice<T>(arr: readonly T[], n: number): T[] {
  if (n === 0) return [...arr];
  return n > 0 ? arr.slice(0, n) : arr.slice(Math.max(0, arr.length + n));
}
export function dropSlice<T>(arr: readonly T[], n: number): T[] {
  if (n === 0) return [...arr];
  return n > 0 ? arr.slice(Math.min(n, arr.length)) : arr.slice(0, Math.max(0, arr.length + n));
}

/** FILTER by a parallel boolean/number mask (Excel's include array). A mask cell
 *  error propagates whole; sizes must match (#SHAPE! is the caller's job). */
export function filterByMask<T>(arr: readonly T[], mask: readonly unknown[]): T[] | SolError {
  const err = firstError(mask);
  if (err) return err;
  return arr.filter((_, i) => {
    const m = mask[i];
    return m === true || (typeof m === "number" && m !== 0);
  });
}

/** MODE.MULT: every most-frequent value (count ≥ 2), first-seen order, keyed by VALUE. */
export function modeMult(arr: readonly unknown[]): unknown[] | SolError {
  const err = firstError(arr);
  if (err) return err;
  const counts = new Map<unknown, { v: unknown; n: number }>();
  for (const v of arr) {
    if (isMissing(v)) continue;
    const k = setKey(v);
    const e = counts.get(k);
    if (e) e.n++; else counts.set(k, { v, n: 1 });
  }
  let best = 0;
  for (const e of counts.values()) best = Math.max(best, e.n);
  if (best < 2) return [];
  return [...counts.values()].filter((e) => e.n === best).map((e) => e.v);
}

/** FREQUENCY(data, bins): counts per interval (≤ bin, ascending) plus one OVERFLOW bucket;
 *  with unsorted bins the counts follow sorted order but report in the GIVEN order. */
export function frequencyBins(data: readonly Cell[], bins: readonly Cell[]): number[] | SolError {
  const err = firstError(data) ?? firstError(bins);
  if (err) return err;
  const xs = data.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const bs = bins.map((b, i) => ({ b: b as number, i })).filter((e) => typeof e.b === "number" && Number.isFinite(e.b));
  const sorted = [...bs].sort((a, c) => a.b - c.b);
  const counts = new Array<number>(bins.length + 1).fill(0);
  for (const x of xs) {
    let placed = false;
    for (let k = 0; k < sorted.length; k++) {
      const lo = k === 0 ? -Infinity : sorted[k - 1].b;
      if (x > lo && x <= sorted[k].b) { counts[sorted[k].i]++; placed = true; break; }
    }
    if (!placed) counts[bins.length]++; // overflow: greater than every bin
  }
  return counts;
}
