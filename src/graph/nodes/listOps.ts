// [[C17]], [[C60]], [[C21]] matchNodeLimits (MAX_GENERATED), [[C110]] rangeIncludesStop
import { isSolError, solError, type SolError } from "../errorValue";
import { isCx } from "../cxValue";
import { isUnitCell } from "../unitValue";
import { forAggregate, ifTest, isMissing } from "../valueKinds";
import { compareStrings } from "../stringOrder";
import { iterMin, iterMax } from "./mathUtils";
import { percentileOf } from "./statsOps";

export type Cell = number | null | SolError;

export function firstError(arr: readonly unknown[]): SolError | null {
  for (const v of arr) if (isSolError(v)) return v;
  return null;
}

// ─── Shape: list in, list out ─────────────────────────────────────────────────

export function reverseList<T>(arr: readonly T[]): T[] {
  return [...arr].reverse();
}

export function sliceList<T>(arr: readonly T[], start: number, end?: number): T[] {
  return arr.slice(Math.max(0, Math.round(start) - 1), end === undefined ? undefined : Math.round(end));
}

export function nthElement<T>(arr: readonly T[], n: number): T[] {
  const step = Math.max(1, Math.round(n));
  return arr.filter((_, i) => i % step === 0);
}

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

export function diffList(arr: readonly Cell[]): Cell[] {
  return arr.slice(1).map((v, i) => {
    const prev = arr[i];
    if (isSolError(v)) return v;
    if (isSolError(prev)) return prev;
    if (isMissing(v) || isMissing(prev)) return null;
    return v - prev;
  });
}

export function normalizeList(arr: readonly Cell[]): Cell[] | SolError {
  const err = firstError(arr);
  if (err) return err;
  const nums = presentNumbers(arr);
  if (nums.length === 0) return arr.map(() => null);
  const mn = iterMin(nums), mx = iterMax(nums);
  return arr.map((v) =>
    typeof v === "number" && Number.isFinite(v) ? (mn === mx ? 0 : (v - mn) / (mx - mn)) : null);
}


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

export function pctChangeList(arr: readonly Cell[]): Cell[] {
  return arr.slice(1).map((v, i) => {
    const prev = arr[i];
    if (isSolError(v)) return v;
    if (isSolError(prev)) return prev;
    if (isMissing(v) || isMissing(prev)) return null;
    if (prev === 0) return solError("#DIV/0!", "Percent change from zero is undefined");
    return (v - prev) / prev;
  });
}

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

export function binIndex(arr: readonly Cell[], breaks: readonly Cell[], rightInclusive = false): Cell[] {
  const edges = presentNumbers(breaks).slice().sort((a, b) => a - b);
  return arr.map((v) => {
    if (isSolError(v)) return v;
    if (!(typeof v === "number" && Number.isFinite(v))) return null;
    let lo = 0, hi = edges.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (rightInclusive ? edges[m] < v : edges[m] <= v) lo = m + 1; else hi = m; }
    return lo;
  });
}

const COMBO_CAP = 10_000;
export function combinationsOf(arr: readonly Cell[], k: number, kind: "combinations" | "permutations"): Cell[][] | SolError {
  const n = arr.length;
  const kk = Math.round(k);
  if (kk < 0) return solError("#VALUE!", "Choose count must be zero or more");
  if (kk > n) return [];
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

export function gradientList(arr: readonly Cell[], dx = 1): Cell[] | SolError {
  const err = firstError(arr);
  if (err) return err;
  const n = arr.length;
  const num = (i: number): number | null => { const v = arr[i]; return typeof v === "number" && Number.isFinite(v) ? v : null; };
  if (n < 2) return arr.map(() => null);
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) {
    let a: number | null, b: number | null, h: number;
    if (i === 0) { a = num(0); b = num(1); h = dx; }
    else if (i === n - 1) { a = num(n - 2); b = num(n - 1); h = dx; }
    else { a = num(i - 1); b = num(i + 1); h = 2 * dx; }
    out.push(a !== null && b !== null ? (b - a) / h : null);
  }
  return out;
}

export function ewmaList(arr: readonly Cell[], alpha: number): Cell[] | SolError {
  const err = firstError(arr);
  if (err) return err;
  if (!(alpha > 0 && alpha <= 1)) return solError("#DOMAIN!", "Alpha must be above 0 and at most 1");
  const a = alpha;
  let prev: number | null = null;
  return arr.map((v) => {
    if (!(typeof v === "number" && Number.isFinite(v))) return prev;
    prev = prev === null ? v : a * v + (1 - a) * prev;
    return prev;
  });
}

export function trapzList(arr: readonly Cell[], dx = 1): Cell | SolError {
  const err = firstError(arr);
  if (err) return err;
  const nums: number[] = [];
  for (const v of arr) {
    if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
    else return solError("#VALUE!", "Trapezoidal integration needs a gap-free numeric list");
  }
  if (nums.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < nums.length; i++) s += ((nums[i] + nums[i - 1]) / 2) * dx;
  return s;
}

export function convolveList(a: readonly Cell[], b: readonly Cell[]): Cell[] | SolError {
  const err = firstError(a) ?? firstError(b);
  if (err) return err;
  const A = a.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
  const B = b.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
  if (A.length === 0 || B.length === 0) return [];
  const out = new Array<number>(A.length + B.length - 1).fill(0);
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) out[i + j] += A[i] * B[j];
  return out;
}

export function rleEncode(arr: readonly Cell[]): Cell[][] {
  const out: Cell[][] = [];
  for (let i = 0; i < arr.length; ) {
    let j = i + 1;
    while (j < arr.length && setKey(arr[j]) === setKey(arr[i])) j++;
    out.push([arr[i], j - i]);
    i = j;
  }
  return out;
}

export function crossProduct(a: readonly Cell[], b: readonly Cell[]): Cell[] | SolError {
  const err = firstError(a) ?? firstError(b);
  if (err) return err;
  const A = presentNumbers(a), B = presentNumbers(b);
  if (A.length !== 3 || B.length !== 3) return solError("#SHAPE!", "Cross product needs two 3-element vectors");
  return [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function polyfitEval(xs: readonly Cell[], ys: readonly Cell[], degree: number): Cell[] | SolError {
  const err = firstError(xs) ?? firstError(ys);
  if (err) return err;
  const isNum = (v: Cell): v is number => typeof v === "number" && Number.isFinite(v);
  const X: number[] = [], Y: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const a = xs[i], b = ys[i];
    if (isNum(a) && isNum(b)) { X.push(a); Y.push(b); }
  }
  const n = X.length;
  const d = Math.max(0, Math.round(degree));
  if (n === 0) return xs.map(() => null);
  if (n < d + 1) return solError("#VALUE!", `A degree-${d} fit needs at least ${d + 1} points`);
  const m = d + 1;
  const ATA: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const ATy: number[] = new Array<number>(m).fill(0);
  for (let k = 0; k < n; k++) {
    const powers: number[] = []; let p = 1;
    for (let j = 0; j < m; j++) { powers.push(p); p *= X[k]; }
    for (let r = 0; r < m; r++) { for (let c = 0; c < m; c++) ATA[r][c] += powers[r] * powers[c]; ATy[r] += powers[r] * Y[k]; }
  }
  const coeffs = solveLinear(ATA, ATy);
  if (!coeffs) return solError("#SOLVE!", "The polynomial fit is singular. The points may be collinear for this degree");
  const evalAt = (xv: number): number => { let acc = 0; for (let j = m - 1; j >= 0; j--) acc = acc * xv + coeffs[j]; return acc; };
  return xs.map((xv) => (isNum(xv) ? evalAt(xv) : null));
}

export type RunningOp = "sum" | "avg" | "min" | "max" | "median" | "product" | "stdev";

export function running(op: RunningOp, arr: readonly Cell[], window: number | null): Cell[] {
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

export function argsortList(arr: readonly Cell[], desc = false): number[] {
  const isTail = (v: unknown) => isMissing(v) || isSolError(v) || typeof v !== "number" || !Number.isFinite(v);
  const idx = arr.map((_, i) => i);
  idx.sort((i, j) => {
    const ti = isTail(arr[i]), tj = isTail(arr[j]);
    if (ti || tj) return ti && tj ? i - j : ti ? 1 : -1;
    const c = (arr[i] as number) - (arr[j] as number);
    return c !== 0 ? (desc ? -c : c) : i - j;
  });
  return idx.map((i) => i + 1);
}

export function whichPositions(arr: readonly unknown[]): number[] {
  const out: number[] = [];
  arr.forEach((v, i) => {
    const hit = v === true || (typeof v === "number" && Number.isFinite(v) && v !== 0) || (typeof v === "string" && v !== "");
    if (hit) out.push(i + 1);
  });
  return out;
}

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

export function lookupEq(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

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
    return solError("#VALUE!", "Approximate match compares numbers. Use exact match (0) for text");
  }
  let bestIdx = -1, bestKey = NaN;
  for (let s = 0; s < n; s++) {
    const i = at(s);
    const k = keys[i];
    if (typeof k !== "number" || !Number.isFinite(k)) continue;
    if (k === lookup) return i;
    if (matchMode === "next_smaller" && k < lookup && (bestIdx === -1 || k > bestKey)) { bestIdx = i; bestKey = k; }
    if (matchMode === "next_larger"  && k > lookup && (bestIdx === -1 || k < bestKey)) { bestIdx = i; bestKey = k; }
  }
  return bestIdx;
}

export function containsValue(arr: readonly unknown[], v: unknown): boolean {
  const k = setKey(v);
  return arr.some((x) => !isMissing(x) && !isSolError(x) && setKey(x) === k);
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

/** A generated array's row or column count, Excel's reading: truncated, and `#VALUE!` below 0 or unreadable. */
export function arrayCount(n: number, fn: string): number | SolError {
  const k = Math.trunc(n);
  return k >= 0 ? k : solError("#VALUE!", `${fn} needs a count of 0 or more`);
}

/** RANDARRAY's bounds check, shared by the formula and the card. */
export function randArrayRange(lo: number, hi: number, whole: boolean): SolError | null {
  if (lo > hi) return solError("#VALUE!", "RANDARRAY's Min is above its Max");
  if (whole && Math.ceil(lo) > Math.floor(hi)) return solError("#VALUE!", "RANDARRAY's Min and Max hold no whole number");
  return null;
}

/** One RANDARRAY value from a [0,1) roll: uniform over [lo, hi), or over the whole numbers in [lo, hi] with each equally likely. */
export function randArrayDraw(roll: number, lo: number, hi: number, whole: boolean): number {
  if (!whole) return lo + roll * (hi - lo);
  const a = Math.ceil(lo);
  return a + Math.floor(roll * (Math.floor(hi) - a + 1));
}

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

export function sequenceList(count: number, start: number, step: number): number[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => start + i * step);
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
/** Equal values share a key: complex by parts, a unit cell by base-SI magnitude and dimension, so 5 km and 5000 m are one member ([[C25]] firstClassUnits). */
export function setKey(v: unknown): unknown {
  if (isCx(v)) return `\x00cx:${v.re},${v.im}`;
  if (isUnitCell(v)) return `\x00u:${v.value}:${Object.keys(v.dim).sort().map((k) => `${k}${v.dim[k]}`).join(",")}`;
  return v;
}

function memberSet(arr: readonly unknown[]): Set<unknown> {
  const s = new Set<unknown>();
  for (const v of arr) if (!isMissing(v) && !isSolError(v)) s.add(setKey(v));
  return s;
}

export type SetOp = "union" | "intersect" | "difference" | "symdiff";

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

export function rangeCount(start: number, stop: number | undefined, step: number): number {
  if (stop === undefined) return 0;
  if (step === 0) return start === stop ? 1 : Infinity;
  const n = Math.floor((stop - start) / step + 1e-9) + 1;
  return n > 0 ? n : 0;
}

export function rangeList(start: number, stop: number | undefined, step: number): number[] {
  const n = rangeCount(start, stop, step);
  if (!Number.isFinite(n)) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // Compute start + i*step rather than accumulating, and snap the last value onto Stop, so float drift never ends 0→1 by 0.1 at 0.9999999.
    let v = start + i * step;
    if (i === n - 1 && stop !== undefined && step !== 0 && Math.abs(v - stop) < Math.abs(step) * 1e-9) v = stop;
    out.push(v);
  }
  return out;
}

export function concatLists(...lists: (readonly unknown[] | null | undefined)[]): unknown[] {
  return lists.flatMap((l) => l ?? []);
}

// ─── Shuffle ──────────────────────────────────────────────────────────────────

export function weightedShuffleKey(u: number, weight: number): number {
  if (!(weight > 0) || !Number.isFinite(weight)) return Infinity;
  const uu = u <= 0 ? Number.EPSILON : u >= 1 ? 1 - Number.EPSILON : u;
  return -Math.log(uu) / weight;
}

export function shuffleList<T>(arr: readonly T[], keys: readonly number[]): T[] {
  return arr
    .map((v, i) => ({ v, k: keys[i] }))
    .sort((a, b) => a.k - b.k)
    .map((p) => p.v);
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

export function takeSlice<T>(arr: readonly T[], n: number): T[] {
  if (n === 0) return [...arr];
  return n > 0 ? arr.slice(0, n) : arr.slice(Math.max(0, arr.length + n));
}
export function dropSlice<T>(arr: readonly T[], n: number): T[] {
  if (n === 0) return [...arr];
  return n > 0 ? arr.slice(Math.min(n, arr.length)) : arr.slice(0, Math.max(0, arr.length + n));
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
    if (!placed) counts[bins.length]++;
  }
  return counts;
}

export function ntileList(arr: readonly Cell[], n: number): Cell[] | SolError {
  const k = Math.round(n);
  if (!(k >= 1)) return solError("#VALUE!", "NTILE needs at least one bucket");
  const nums = presentNumbers(arr);
  if (nums.length === 0) return arr.map((v) => (isSolError(v) ? v : null));
  const sorted = [...nums].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let i = 1; i < k; i++) edges.push(percentileOf(sorted, i / k, false));
  return binIndex(arr, edges, true).map((v) => (typeof v === "number" ? v + 1 : v));
}

export type OutlierMethod = "z" | "iqr" | "mad";
export const OUTLIER_DEFAULT_THRESHOLD: Record<OutlierMethod, number> = { z: 3, iqr: 1.5, mad: 3.5 };

export function outlierFlags(arr: readonly Cell[], method: OutlierMethod, threshold: number): (boolean | null | SolError)[] {
  const nums = presentNumbers(arr);
  const no = () => arr.map((v) => (isSolError(v) ? v : v == null ? null : false));
  if (nums.length < 3) return no();
  let test: (v: number) => boolean;
  if (method === "z") {
    const m = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sd = Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / (nums.length - 1));
    if (sd === 0) return no();
    test = (v) => Math.abs((v - m) / sd) > threshold;
  } else if (method === "iqr") {
    const s = [...nums].sort((a, b) => a - b);
    const q1 = percentileOf(s, 0.25, false), q3 = percentileOf(s, 0.75, false), iqr = q3 - q1;
    if (iqr === 0) return no();
    test = (v) => v < q1 - threshold * iqr || v > q3 + threshold * iqr;
  } else {
    const s = [...nums].sort((a, b) => a - b);
    const med = percentileOf(s, 0.5, false);
    const dev = nums.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    const mad = percentileOf(dev, 0.5, false);
    if (mad === 0) return no();
    test = (v) => Math.abs((0.6745 * (v - med)) / mad) > threshold;
  }
  return arr.map((v) => (isSolError(v) ? v : typeof v === "number" && Number.isFinite(v) ? test(v) : null));
}

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
export function spectrum(x: readonly Cell[], rate = 1): SpectrumRow[] {
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

/** Shared with the pack's ISIN formula. */
export function isInMask(a: readonly unknown[], b: readonly unknown[]): (boolean | null | SolError)[] {
  const members = new Set<unknown>();
  for (const v of b) if (!isMissing(v) && !isSolError(v)) members.add(setKey(v));
  return a.map((v) => {
    if (isMissing(v)) return null;
    if (isSolError(v)) return v as SolError;
    return members.has(setKey(v));
  });
}

/** Shared with the pack's TALLY formula. */
export function tallyPairs(list: readonly unknown[]): { values: unknown[]; counts: number[] } {
  const counts = new Map<unknown, { value: unknown; count: number }>();
  for (const v of list) {
    if (isMissing(v) || isSolError(v)) continue;
    const k = setKey(v);
    const e = counts.get(k);
    if (e) e.count++; else counts.set(k, { value: v, count: 1 });
  }
  const entries = [...counts.values()];
  return { values: entries.map((e) => e.value), counts: entries.map((e) => e.count) };
}
