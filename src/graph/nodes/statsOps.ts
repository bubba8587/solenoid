// [[C17]] shareImpl, [[D36]] nullSkippedNotZero, [[D51]] oneAnswerOneDivergence, [[D48]] classifyNonFinite, [[C14]] currentExcelParity, [[D70]] nullNotEnoughData
// Inputs are prepared numbers (errors propagated, blanks skipped by the caller); null means not enough data and shows as a blank, a SolError is a real domain failure.
import { solError, type SolError } from "../errorValue";
import { guardFinite } from "../valueKinds";
import { iterMin, iterMax } from "./mathUtils";

export type AggregateOp =
  | "sum" | "avg" | "min" | "max" | "count" | "countdistinct" | "median" | "product" | "stdev"
  | "geomean" | "harmean" | "sumsq" | "var_s" | "var_p" | "stdev_p" | "devsq" | "avedev" | "skew" | "skew_p" | "kurt"
  | "ptp" | "iqr" | "mad" | "sem" | "cv" | "rms";

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: readonly number[]) => sum(a) / a.length;
const ssd = (a: readonly number[], m: number) => a.reduce((x, y) => x + (y - m) ** 2, 0);

export function aggregate(op: AggregateOp, arr: readonly number[]): number | SolError | null {
  if (op !== "count" && op !== "countdistinct" && arr.some((v) => Number.isNaN(v))) return guardFinite(NaN, arr);
  const r = aggregateRaw(op, arr);
  return typeof r === "number" ? guardFinite(r, arr) : r;
}

function aggregateRaw(op: AggregateOp, arr: readonly number[]): number | SolError | null {
  if (arr.length === 0) return op === "sum" || op === "count" ? 0 : op === "product" ? 1 : null;
  const n = arr.length;
  switch (op) {
    case "sum":     return sum(arr);
    case "avg":     return mean(arr);
    case "min":     return iterMin(arr);
    case "max":     return iterMax(arr);
    case "count":   return n;
    case "countdistinct": return new Set(arr).size;
    case "product": return arr.reduce((a, b) => a * b, 1);
    case "median": {
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
    }
    case "stdev":   return n === 0 ? null : n < 2 ? solError("#DIV/0!", "A sample standard deviation needs at least two values") : Math.sqrt(ssd(arr, mean(arr)) / (n - 1));
    case "stdev_p": return Math.sqrt(ssd(arr, mean(arr)) / n);
    case "var_s":   return n === 0 ? null : n < 2 ? solError("#DIV/0!", "A sample variance needs at least two values") : ssd(arr, mean(arr)) / (n - 1);
    case "var_p":   return ssd(arr, mean(arr)) / n;
    case "geomean": return arr.some((v) => v <= 0) ? solError("#DOMAIN!", "GEOMEAN needs every value > 0") : Math.exp(arr.reduce((a, b) => a + Math.log(b), 0) / n);
    case "harmean": return arr.some((v) => v <= 0) ? solError("#DOMAIN!", "HARMEAN needs every value > 0") : n / arr.reduce((a, b) => a + 1 / b, 0);
    case "sumsq":   return arr.reduce((a, b) => a + b * b, 0);
    case "devsq":   return ssd(arr, mean(arr));
    case "avedev": { const m = mean(arr); return arr.reduce((a, b) => a + Math.abs(b - m), 0) / n; }
    case "skew": {
      if (n < 3) return null;
      const m = mean(arr), s = Math.sqrt(ssd(arr, m) / (n - 1));
      if (s === 0) return null;
      return (n / ((n - 1) * (n - 2))) * arr.reduce((a, b) => a + ((b - m) / s) ** 3, 0);
    }
    case "skew_p": {
      if (n < 2) return null;
      const m = mean(arr), s = Math.sqrt(ssd(arr, m) / n);
      if (s === 0) return null;
      return arr.reduce((a, b) => a + ((b - m) / s) ** 3, 0) / n;
    }
    case "kurt": {
      if (n < 4) return null;
      const m = mean(arr), s = Math.sqrt(ssd(arr, m) / (n - 1));
      if (s === 0) return null;
      const sum4 = arr.reduce((a, b) => a + ((b - m) / s) ** 4, 0);
      return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum4 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
    }
    case "ptp":  return iterMax(arr) - iterMin(arr);
    case "iqr": {
      const s = [...arr].sort((a, b) => a - b);
      return percentileOf(s, 0.75, false) - percentileOf(s, 0.25, false);
    }
    case "mad": {
      const med = aggregateRaw("median", arr) as number;
      return aggregateRaw("median", arr.map((v) => Math.abs(v - med)));
    }
    case "sem":  return n < 2 ? null : Math.sqrt(ssd(arr, mean(arr)) / (n - 1)) / Math.sqrt(n);
    case "cv": {
      if (n < 2) return null;
      const m = mean(arr);
      return m === 0 ? solError("#DIV/0!", "CV is undefined when the mean is 0") : Math.sqrt(ssd(arr, m) / (n - 1)) / m;
    }
    case "rms":  return Math.sqrt(arr.reduce((a, b) => a + b * b, 0) / n);
  }
}

export function percentileOf(sorted: readonly number[], p: number, exc: boolean): number {
  const n = sorted.length;
  const i = exc ? p * (n + 1) - 1 : p * (n - 1);
  const lo = Math.floor(i), hi = exc ? Math.min(n - 1, Math.ceil(i)) : Math.ceil(i);
  const a = sorted[lo], b = sorted[hi], t = i - lo;
  if (a === b) return a;
  return Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : (1 - t) * a + t * b;
}

export function percentile(arr: readonly number[], p: number, exc: boolean): number | SolError | null {
  const n = arr.length;
  if (n === 0) return null;
  if (!exc && (p < 0 || p > 1)) return solError("#DOMAIN!", "Percentile must be between 0 and 1");
  if (exc && (p < 1 / (n + 1) || p > n / (n + 1))) {
    return solError("#DOMAIN!", "Percentile is outside the EXC domain: it must lie strictly between 1/(n+1) and n/(n+1)");
  }
  return guardFinite(percentileOf([...arr].sort((a, b) => a - b), p, exc), arr);
}

export function quartile(arr: readonly number[], q: number, exc: boolean): number | SolError | null {
  const qi = Math.trunc(q);
  if (arr.length === 0) return null;
  if (qi < 0 || qi > 4) return solError("#DOMAIN!", "Quartile must be 0, 1, 2, 3, or 4");
  if (exc && (qi === 0 || qi === 4)) return solError("#DOMAIN!", "QUARTILE.EXC is undefined for quartile 0 or 4");
  const n = arr.length, p = qi / 4;
  if (exc && (p < 1 / (n + 1) || p > n / (n + 1))) {
    return solError("#DOMAIN!", "Quartile is outside the EXC domain: q/4 must lie between 1/(n+1) and n/(n+1)");
  }
  return guardFinite(percentileOf([...arr].sort((a, b) => a - b), p, exc), arr);
}

/** The first `n` items, without a copy when that is all of them. */
const head = (xs: readonly number[], n: number): readonly number[] => (n === xs.length ? xs : xs.slice(0, n));

export function pearson(xs: readonly number[], ys: readonly number[], rsq = false): number | SolError | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(head(xs, n)), my = mean(head(ys, n));
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  if (den === 0) return solError("#DIV/0!", "One of the lists has zero variance");
  const r = num / den;
  const out = rsq ? r * r : r;
  return Number.isFinite(out) ? out : guardFinite(out, xs.concat(ys));
}

export function averageRanks(arr: readonly number[]): number[] {
  const idx = arr.map((_, i) => i).sort((a, b) => arr[a] - arr[b]);
  const ranks = new Array<number>(arr.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && arr[idx[j + 1]] === arr[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = r;
    i = j + 1;
  }
  return ranks;
}

export function spearman(xs: readonly number[], ys: readonly number[]): number | SolError | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  return pearson(averageRanks(xs.slice(0, n)), averageRanks(ys.slice(0, n)));
}

/** Pairs counted in O(n log n) (Knight): sort by x then y, count the tied runs, and count y's inversions while merge
 *  sorting it; the counts are the pairwise loop's exactly. Finite values only, where a difference's sign is the order. */
function kendallCounts(xs: readonly number[], ys: readonly number[], n: number): { conc: number; disc: number; tx: number; ty: number } {
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => (xs[a] < xs[b] ? -1 : xs[a] > xs[b] ? 1 : ys[a] < ys[b] ? -1 : ys[a] > ys[b] ? 1 : 0));
  const pairs = (t: number) => (t * (t - 1)) / 2;
  let n1 = 0, n3 = 0;
  for (let i = 0; i < n; ) {
    let j = i, k = i;
    while (j + 1 < n && xs[idx[j + 1]] === xs[idx[i]]) j++;
    n1 += pairs(j - i + 1);
    for (; k <= j; ) {
      let m = k;
      while (m + 1 <= j && ys[idx[m + 1]] === ys[idx[k]]) m++;
      n3 += pairs(m - k + 1);
      k = m + 1;
    }
    i = j + 1;
  }
  let y = idx.map((i) => ys[i]);
  let buf = new Array<number>(n);
  let swaps = 0;
  for (let w = 1; w < n; w *= 2) {
    for (let lo = 0; lo < n; lo += 2 * w) {
      const mid = Math.min(lo + w, n), hi = Math.min(lo + 2 * w, n);
      let a = lo, b = mid, o = lo;
      while (a < mid && b < hi) {
        if (y[b] < y[a]) { swaps += mid - a; buf[o++] = y[b++]; } else buf[o++] = y[a++];
      }
      while (a < mid) buf[o++] = y[a++];
      while (b < hi) buf[o++] = y[b++];
    }
    [y, buf] = [buf, y];
  }
  let n2 = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && y[j + 1] === y[i]) j++;
    n2 += pairs(j - i + 1);
    i = j + 1;
  }
  return { conc: pairs(n) - n1 - n2 + n3 - swaps, disc: swaps, tx: n1 - n3, ty: n2 - n3 };
}

export function kendallTau(xs: readonly number[], ys: readonly number[]): number | SolError | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let conc = 0, disc = 0, tx = 0, ty = 0;
  let finite = true;
  for (let i = 0; i < n && finite; i++) finite = Number.isFinite(xs[i]) && Number.isFinite(ys[i]);
  if (finite) ({ conc, disc, tx, ty } = kendallCounts(xs, ys, n));
  // NaN and two equal infinities have no sign of difference, which the pairwise reading counts as discordant.
  else for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = Math.sign(xs[i] - xs[j]), dy = Math.sign(ys[i] - ys[j]);
    if (dx === 0 && dy === 0) continue;
    if (dx === 0) { tx++; continue; }
    if (dy === 0) { ty++; continue; }
    if (dx === dy) conc++; else disc++;
  }
  const den = Math.sqrt((conc + disc + tx) * (conc + disc + ty));
  if (den === 0) return solError("#DIV/0!", "One of the lists has no variation");
  return (conc - disc) / den;
}

export function covariance(xs: readonly number[], ys: readonly number[], sample: boolean): number | SolError | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(head(xs, n)), my = mean(head(ys, n));
  let cov = 0;
  for (let i = 0; i < n; i++) cov += (xs[i] - mx) * (ys[i] - my);
  const out = sample ? cov / (n - 1) : cov / n;
  return Number.isFinite(out) ? out : guardFinite(out, xs.concat(ys));
}

/** Excel's MODE: with no value appearing twice there is no mode. */
export const noMode = (): SolError => solError("#N/A", "No value repeats, so there is no mode");

export function modes(arr: readonly number[]): number | number[] | SolError | null {
  if (arr.length === 0) return null;
  if (arr.some((v) => Number.isNaN(v))) return guardFinite(NaN, arr);
  const counts = new Map<number, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = iterMax(counts.values());
  if (maxCount < 2) return noMode();
  const ms = [...counts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v).sort((a, b) => a - b);
  return ms.length === 1 ? ms[0] : ms;
}

export function fisher(x: number, inverse: boolean): number | SolError {
  if (inverse) return Math.tanh(x);
  return x <= -1 || x >= 1 ? solError("#DOMAIN!", "FISHER requires −1 < x < 1") : Math.atanh(x);
}

export function regression(xs: readonly number[], ys: readonly number[], op: "slope" | "intercept" | "steyx"): number | SolError | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const xMean = mean(xs.slice(0, n)), yMean = mean(ys.slice(0, n));
  let SSxy = 0, SSxx = 0, SSyy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean, dy = ys[i] - yMean;
    SSxy += dx * dy; SSxx += dx * dx; SSyy += dy * dy;
  }
  if (SSxx === 0) return solError("#DIV/0!", "Known Xs have zero variance");
  const slope = SSxy / SSxx;
  const r = op === "slope" ? slope : op === "intercept" ? yMean - slope * xMean
    : n >= 3 ? Math.sqrt(Math.max(0, SSyy - slope * SSxy) / (n - 2)) : null;
  return r === null ? null : guardFinite(r, xs.concat(ys));
}

// ─── Hypothesis tests beyond Excel's four ──────────

