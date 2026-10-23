// [[C17]], [[B11]] (MAX_GENERATED), [[C110]] rangeIncludesStop
import { isSolError, type SolError } from "../errorValue";
import { isCx } from "../cxValue";
import { isUnitCell, type UnitCell, forAggregateUnits, isAffineDisplay, tagDim, unitError, READINGS_ADD } from "../unitValue";
import { dimEqual, dimPow, isDimensionless } from "../dimension";
import { forAggregate, ifTest, isMissing } from "../valueKinds";
import { compareStrings } from "../stringOrder";
import { iterMin, iterMax } from "./mathUtils";

export type Cell = number | null | SolError;

export function firstError(arr: readonly unknown[]): SolError | null {
  for (const v of arr) if (isSolError(v)) return v;
  return null;
}

// ─── Shape: list in, list out ─────────────────────────────────────────────────

export function interleave<T>(a: readonly T[], b: readonly T[]): (T | null)[] {
  const n = Math.max(a.length, b.length);
  const out: (T | null)[] = [];
  for (let i = 0; i < n; i++) out.push(i < a.length ? a[i] : null, i < b.length ? b[i] : null);
  return out;
}

export type PadDir = "right" | "left";

export type RunningOp = "sum" | "avg" | "min" | "max" | "median" | "product" | "stdev";

/** A list of one unit runs on its magnitudes and keeps the unit, as Reduce does: a product's power grows with its count,
 *  and over °C a spread is a delta and two readings have no sum. */
export function running(op: RunningOp, arr: readonly (Cell | UnitCell)[], window: number | null): (Cell | UnitCell)[] | SolError {
  if (!arr.some(isUnitCell)) return runningPlain(op, arr as readonly Cell[], window);
  // An error cell stays in place and runs as it does without units.
  const prep = forAggregateUnits(arr.filter((v) => !isSolError(v)), op !== "sum");
  if (prep.error) return prep.error;
  const affine = isAffineDisplay(prep.display);
  if (affine && op === "sum" && arr.filter((c) => isUnitCell(c) && isAffineDisplay(c.display)).length > 1) return unitError(READINGS_ADD);
  let k = 0;
  const mags: Cell[] = arr.map((v) => (isSolError(v) ? v : isMissing(v) ? null : prep.nums[k++]));
  const out = runningPlain(op, mags, window);
  const w = window !== null && Math.round(window) >= 1 ? Math.round(window) : Infinity;
  const counted = mags.map((v) => (typeof v === "number" && Number.isFinite(v) ? 1 : 0));
  const display = affine && op === "stdev" ? undefined : prep.display;
  return out.map((v, i) => {
    if (typeof v !== "number" || isDimensionless(prep.dim)) return v;
    const n = counted.slice(Math.max(0, i - w + 1), i + 1).reduce((a: number, b) => a + b, 0);
    const dim = op === "product" ? dimPow(prep.dim, n) : prep.dim;
    return tagDim(v, dim, dimEqual(dim, prep.dim) ? display : undefined);
  });
}

function runningPlain(op: RunningOp, arr: readonly Cell[], window: number | null): Cell[] {
  if (window !== null && Math.round(window) >= 1) {
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
          if (nums.length < 2) return null;
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
  // The cumulative path streams in one pass and must answer exactly what the sliding path would with window = arr.length.
  let err: SolError | null = null;
  let count = 0, sum = 0, product = 1, mn = Infinity, mx = -Infinity;
  let mean = 0, m2 = 0;
  const sorted: number[] = [];
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

export type ArgMinMaxOp = "argmax" | "argmin" | "argsort" | "argsort_desc" | "which";
export const ARG_LIST_OPS: ReadonlySet<ArgMinMaxOp> = new Set(["argsort", "argsort_desc", "which"]);

export type XMatchMatchMode = "exact" | "next_larger" | "next_smaller";
export type XMatchSearchMode = "first" | "last";

export function lookupEq(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// ─── Weighted statistics ──────────────────────────────────────────────────────

export type WeightedOp = "wavg" | "wvar" | "wstdev";

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

export const MAX_GENERATED = 1_000_000;

export function linspace(start: number, end: number, count: number): number[] {
  const n = Math.round(count);
  if (n <= 0) return [];
  if (n === 1) return [start];
  return Array.from({ length: n }, (_, i) => start + i * (end - start) / (n - 1));
}

export function geometric(start: number, ratio: number, count: number): number[] {
  const n = Math.max(0, Math.round(count));
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < n; i++) { out.push(v); v *= ratio; }
  return out;
}

export function fibonacci(count: number): number[] {
  const n = Math.min(78, Math.max(0, Math.round(count)));
  if (n === 0) return [];
  const out = [1];
  if (n > 1) out.push(1);
  for (let i = 2; i < n; i++) out.push(out[i - 1] + out[i - 2]);
  return out;
}

// ─── Sets ─────────────────────────────────────────────────────────────────────
// JavaScript Sets key objects by reference, so a complex value canonicalizes to a string; primitives key as themselves.
/** Equal values share a key: complex by parts, a unit cell by base-SI magnitude (15 significant digits) and dimension, so 5 km and 5000 m, or 1.1 h and 3960 s, are one member ([[C25]] firstClassUnits). */
export function setKey(v: unknown): unknown {
  if (isCx(v)) return `\x00cx:${v.re},${v.im}`;
  // A zero exponent is no dimension, as `dimEqual` reads it.
  if (isUnitCell(v)) return `\x00u:${+v.value.toPrecision(15)}:${Object.keys(v.dim).filter((k) => v.dim[k]).sort().map((k) => `${k}${v.dim[k]}`).join(",")}`;
  return v;
}

export type SetOp = "union" | "intersect" | "difference" | "symdiff";

export type SetRelation = "equal" | "subset" | "superset" | "disjoint";

// ─── Fill / Coalesce — the opt-in to treat a missing as something ──────────────

export type FillOp =
  | "constant" | "ffill" | "bfill" | "mean" | "median" | "mode"
  | "interpolate" | "drop" | "coalesce";

export function presentNumbers(arr: readonly Cell[]): number[] {
  return arr.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

export function imputeStat(arr: readonly Cell[], op: "mean" | "median" | "mode"): number | null {
  const nums = presentNumbers(arr);
  if (nums.length === 0) return null;
  if (op === "mean") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (op === "median") {
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  }
  const counts = new Map<number, number>();
  let best = nums[0], bestCount = 0;
  for (const v of nums) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) { bestCount = c; best = v; }
  }
  return best;
}

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

// ─── Range ────────────────────────────────────────────────────────────────────

export function rangeCount(start: number, stop: number | undefined, step: number): number {
  if (stop === undefined) return 0;
  if (step === 0) return start === stop ? 1 : Infinity;
  const n = Math.floor((stop - start) / step + 1e-9) + 1;
  return n > 0 ? n : 0;
}

// ─── Shuffle ──────────────────────────────────────────────────────────────────

export function weightedShuffleKey(u: number, weight: number): number {
  if (!(weight > 0) || !Number.isFinite(weight)) return Infinity;
  const uu = u <= 0 ? Number.EPSILON : u >= 1 ? 1 - Number.EPSILON : u;
  return -Math.log(uu) / weight;
}

// ─── Array-returning core ([[C15]] matricesInFormulas) ──────────────────────────

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

const sortKind = (v: unknown): number => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3);
const sortsLast = (v: unknown): boolean => isMissing(v) || isSolError(v) || (typeof v === "number" && Number.isNaN(v));

/** One order for every list sort: numbers by value, then text by character code ([[C59]] byteStringOrder), then FALSE and TRUE, Excel's order across kinds. Blanks, errors and NaN go last in either direction. */
export function compareListCells(a: unknown, b: unknown): number {
  const ka = sortKind(a), kb = sortKind(b);
  if (ka !== kb) return ka - kb;
  if (ka === 0) return (a as number) - (b as number);
  if (ka === 1) return compareStrings(a as string, b as string);
  if (ka === 2) return Number(a) - Number(b);
  return 0;
}

function sortedIndex(keys: readonly unknown[], n: number, desc: boolean): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((i, j) => {
    const ki = i < keys.length ? keys[i] : null, kj = j < keys.length ? keys[j] : null;
    const ti = sortsLast(ki), tj = sortsLast(kj);
    if (ti || tj) return ti && tj ? i - j : ti ? 1 : -1;
    const c = compareListCells(ki, kj);
    return c !== 0 ? (desc ? -c : c) : i - j;
  });
  return idx;
}

export function sortList(arr: readonly Cell[], desc = false): Cell[] {
  return sortedIndex(arr, arr.length, desc).map((i) => arr[i]);
}

export function sortByKeys<T>(arr: readonly T[], by: readonly unknown[], desc = false): (T | null)[] {
  return sortedIndex(by, Math.max(arr.length, by.length), desc).map((i) => (i < arr.length ? arr[i] : null));
}

/** FILTER's include array read as IF reads a condition ([[E10]] pickVsAggregateErrors: the mask is read whole, so its first error is the answer). A blank keeps nothing. */
export function filterByMask<T>(arr: readonly T[], mask: readonly unknown[]): T[] | SolError {
  const keep: boolean[] = [];
  for (const m of mask) {
    const t = ifTest(m);
    if (isSolError(t)) return t;
    keep.push(t === true);
  }
  return arr.filter((_, i) => keep[i]);
}

// ─── Table sorts, filters and uniques ([[D85]] columnsStayColumns: a list is one row) ──────────
// Excel's SORT, SORTBY, FILTER and UNIQUE on a table. The caller turns a list into its one row and back.

export const transposeGrid = <T>(m: readonly (readonly T[])[]): T[][] =>
  (m[0] ?? []).map((_, j) => m.map((r) => r[j]));

export type OutlierMethod = "z" | "iqr" | "mad";

export function fftReal(x: readonly number[]): { re: number[]; im: number[] } {
  const n = x.length;
  if (n === 0) return { re: [], im: [] };
  if (n === 1) return { re: [x[0]], im: [0] };
  const isPow2 = (n & (n - 1)) === 0;
  const re = [...x], im = new Array<number>(n).fill(0);
  if (isPow2) { fftInPlace(re, im, false); return { re, im }; }
  // Bluestein: multiply by the chirp, convolve with its conjugate through a power-of-two FFT of size m ≥ 2n−1, multiply back.
  let m = 1; while (m < 2 * n - 1) m <<= 1;
  const cosT: number[] = [], sinT: number[] = [];
  for (let k = 0; k < n; k++) { const ang = (Math.PI * ((k * k) % (2 * n))) / n; cosT.push(Math.cos(ang)); sinT.push(Math.sin(ang)); }
  const aRe = new Array<number>(m).fill(0), aIm = new Array<number>(m).fill(0);
  for (let k = 0; k < n; k++) { aRe[k] = x[k] * cosT[k]; aIm[k] = -x[k] * sinT[k]; }
  const bRe = new Array<number>(m).fill(0), bIm = new Array<number>(m).fill(0);
  bRe[0] = cosT[0]; bIm[0] = sinT[0];
  for (let k = 1; k < n; k++) { bRe[k] = bRe[m - k] = cosT[k]; bIm[k] = bIm[m - k] = sinT[k]; }
  fftInPlace(aRe, aIm, false); fftInPlace(bRe, bIm, false);
  for (let k = 0; k < m; k++) { const r = aRe[k] * bRe[k] - aIm[k] * bIm[k]; const i = aRe[k] * bIm[k] + aIm[k] * bRe[k]; aRe[k] = r; aIm[k] = i; }
  fftInPlace(aRe, aIm, true);
  const outRe: number[] = [], outIm: number[] = [];
  for (let k = 0; k < n; k++) { outRe.push(aRe[k] * cosT[k] + aIm[k] * sinT[k]); outIm.push(aIm[k] * cosT[k] - aRe[k] * sinT[k]); }
  return { re: outRe, im: outIm };
}

function fftInPlace(re: number[], im: number[], inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len / 2] * cRe - im[i + j + len / 2] * cIm;
        const vIm = re[i + j + len / 2] * cIm + im[i + j + len / 2] * cRe;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe; im[i + j + len / 2] = uIm - vIm;
        const nRe = cRe * wRe - cIm * wIm; cIm = cRe * wIm + cIm * wRe; cRe = nRe;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export interface SpectrumRow { bin: number; frequency: number; magnitude: number; phase: number }
export function spectrum(x: readonly Cell[], rate: number | SolError = 1): SpectrumRow[] | SolError {
  if (isSolError(rate)) return rate;
  const err = firstError(x);
  if (err) return err;
  const sig = x.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
  const n = sig.length;
  if (n === 0) return [];
  const { re, im } = fftReal(sig);
  const rows: SpectrumRow[] = [];
  const half = Math.floor(n / 2);
  for (let k = 0; k <= half; k++) {
    const mag = Math.hypot(re[k], im[k]);
    const scale = k === 0 || (n % 2 === 0 && k === half) ? 1 / n : 2 / n;
    rows.push({ bin: k, frequency: (k * rate) / n, magnitude: mag * scale, phase: Math.atan2(im[k], re[k]) });
  }
  return rows;
}

