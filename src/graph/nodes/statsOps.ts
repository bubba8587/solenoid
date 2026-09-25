// [[C17]] shareImpl, [[D36]] nullSkippedNotZero, [[D51]] oneAnswerOneDivergence, [[D48]] classifyNonFinite, [[C14]] currentExcelParity, [[D70]] nullNotEnoughData
// Inputs are prepared numbers (errors propagated, blanks skipped by the caller); null means not enough data and shows as a blank, a SolError is a real domain failure.
import { solError, type SolError } from "../errorValue";
import { guardFinite } from "../valueKinds";
import { iterMin, iterMax, stdNormCDF, fCDF, chiSqCDF, lnCombin } from "./mathUtils";

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
  const qi = Math.round(q);
  if (arr.length === 0) return null;
  if (qi < 0 || qi > 4) return solError("#DOMAIN!", "Quartile must be 0, 1, 2, 3, or 4");
  if (exc && (qi === 0 || qi === 4)) return solError("#DOMAIN!", "QUARTILE.EXC is undefined for quartile 0 or 4");
  const n = arr.length, p = qi / 4;
  if (exc && (p < 1 / (n + 1) || p > n / (n + 1))) {
    return solError("#DOMAIN!", "Quartile is outside the EXC domain: q/4 must lie between 1/(n+1) and n/(n+1)");
  }
  return guardFinite(percentileOf([...arr].sort((a, b) => a - b), p, exc), arr);
}

export function nthExtreme(arr: readonly number[], k: number, largest: boolean): number | null {
  const ki = Math.round(k);
  if (arr.length === 0 || ki < 1 || ki > arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return largest ? sorted[arr.length - ki] : sorted[ki - 1];
}

export function pearson(xs: readonly number[], ys: readonly number[], rsq = false): number | SolError | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  if (den === 0) return solError("#DIV/0!", "One of the lists has zero variance");
  const r = num / den;
  return guardFinite(rsq ? r * r : r, xs.concat(ys));
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

export function kendallTau(xs: readonly number[], ys: readonly number[]): number | SolError | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let conc = 0, disc = 0, tx = 0, ty = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
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
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  const cov = xs.slice(0, n).reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  return guardFinite(sample ? cov / (n - 1) : cov / n, xs.concat(ys));
}

export function modes(arr: readonly number[]): number | number[] | null {
  if (arr.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = iterMax(counts.values());
  const ms = [...counts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v).sort((a, b) => a - b);
  return ms.length === 1 ? ms[0] : ms;
}

export function fisher(x: number, inverse: boolean): number | SolError {
  if (inverse) return Math.tanh(x);
  return x <= -1 || x >= 1 ? solError("#DOMAIN!", "FISHER requires −1 < x < 1") : Math.atanh(x);
}

export function modeSingle(arr: readonly number[]): number | null {
  if (arr.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = iterMax(counts.values());
  for (const v of arr) if (counts.get(v) === maxCount) return v;
  return null;
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

const twoSidedZ = (z: number): number => 2 * (1 - stdNormCDF(Math.abs(z)));
function tieTerm(values: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let t = 0;
  for (const c of counts.values()) if (c > 1) t += c ** 3 - c;
  return t;
}

export function anovaP(groups: readonly (readonly number[])[]): number | null {
  const gs = groups.filter((g) => g.length > 0);
  const k = gs.length, N = gs.reduce((a, g) => a + g.length, 0);
  if (k < 2 || N <= k) return null;
  const grand = gs.reduce((a, g) => a + sum(g), 0) / N;
  let ssb = 0, ssw = 0;
  for (const g of gs) { const m = mean(g); ssb += g.length * (m - grand) ** 2; ssw += ssd(g, m); }
  if (ssw === 0) return ssb === 0 ? null : 0;
  const F = (ssb / (k - 1)) / (ssw / (N - k));
  return Math.min(1, Math.max(0, 1 - fCDF(F, k - 1, N - k)));
}

export function mannWhitneyP(a: readonly number[], b: readonly number[]): number | null {
  const n1 = a.length, n2 = b.length, N = n1 + n2;
  if (n1 === 0 || n2 === 0) return null;
  const ranks = averageRanks([...a, ...b]);
  const r1 = ranks.slice(0, n1).reduce((x, y) => x + y, 0);
  const u1 = r1 - (n1 * (n1 + 1)) / 2, u = Math.min(u1, n1 * n2 - u1);
  const meanU = (n1 * n2) / 2;
  const varU = ((n1 * n2) / 12) * ((N + 1) - tieTerm([...a, ...b]) / (N * (N - 1)));
  if (varU <= 0) return null;
  const z = (Math.abs(u - meanU) - 0.5) / Math.sqrt(varU);
  return Math.min(1, twoSidedZ(Math.max(0, z)));
}

export function wilcoxonSignedRankP(a: readonly number[], b: readonly number[]): number | null {
  const n0 = Math.min(a.length, b.length);
  const d: number[] = [];
  for (let i = 0; i < n0; i++) { const v = a[i] - b[i]; if (v !== 0) d.push(v); }
  const n = d.length;
  if (n === 0) return null;
  const ranks = averageRanks(d.map(Math.abs));
  const wPlus = d.reduce((acc, v, i) => acc + (v > 0 ? ranks[i] : 0), 0);
  const t = Math.min(wPlus, (n * (n + 1)) / 2 - wPlus);
  const meanT = (n * (n + 1)) / 4;
  const varT = (n * (n + 1) * (2 * n + 1)) / 24 - tieTerm(d.map(Math.abs)) / 48;
  if (varT <= 0) return null;
  const z = (Math.abs(t - meanT) - 0.5) / Math.sqrt(varT);
  return Math.min(1, twoSidedZ(Math.max(0, z)));
}

export function kruskalP(groups: readonly (readonly number[])[]): number | null {
  const gs = groups.filter((g) => g.length > 0);
  const k = gs.length, N = gs.reduce((a, g) => a + g.length, 0);
  if (k < 2 || N < 3) return null;
  const all = gs.flat();
  const ranks = averageRanks(all);
  let h = 0, off = 0;
  for (const g of gs) { const r = ranks.slice(off, off + g.length).reduce((x, y) => x + y, 0); h += (r * r) / g.length; off += g.length; }
  h = (12 / (N * (N + 1))) * h - 3 * (N + 1);
  const corr = 1 - tieTerm(all) / (N ** 3 - N);
  if (corr <= 0) return null;
  h /= corr;
  return Math.min(1, Math.max(0, 1 - chiSqCDF(h, k - 1)));
}

export function fisherExactP(a: number, b: number, c: number, d: number): number | null {
  const cells = [a, b, c, d].map((v) => Math.round(v));
  if (cells.some((v) => v < 0 || !Number.isFinite(v))) return null;
  const [A, B, C, D] = cells;
  const row1 = A + B, col1 = A + C, N = A + B + C + D;
  if (N === 0) return null;
  const pmf = (x: number): number => Math.exp(lnCombin(col1, x) + lnCombin(N - col1, row1 - x) - lnCombin(N, row1));
  const lo = Math.max(0, row1 - (N - col1)), hi = Math.min(row1, col1);
  const pObs = pmf(A);
  let p = 0;
  for (let x = lo; x <= hi; x++) { const px = pmf(x); if (px <= pObs * (1 + 1e-7)) p += px; }
  return Math.min(1, p);
}

export function ksTwoSampleP(a: readonly number[], b: readonly number[]): number | null {
  const n1 = a.length, n2 = b.length;
  if (n1 === 0 || n2 === 0) return null;
  const sa = [...a].sort((x, y) => x - y), sb = [...b].sort((x, y) => x - y);
  // D as the integer |i·n2 − j·n1| (the ECDF gap scaled by n1·n2), walked over the merge.
  let i = 0, j = 0, dInt = 0;
  while (i < n1 && j < n2) {
    const v = Math.min(sa[i], sb[j]);
    while (i < n1 && sa[i] <= v) i++;
    while (j < n2 && sb[j] <= v) j++;
    dInt = Math.max(dInt, Math.abs(i * n2 - j * n1));
  }
  if (dInt === 0) return 1;
  // prob[j] = P(a random path reaches (i, j) without ever touching |i·n2 − j·n1| ≥ dInt).
  let prob = new Array<number>(n2 + 1).fill(0);
  prob[0] = 1;
  for (let ii = 0; ii <= n1; ii++) {
    const next = new Array<number>(n2 + 1).fill(0);
    for (let jj = 0; jj <= n2; jj++) {
      if (ii === 0 && jj === 0) { next[0] = 1; continue; }
      if (Math.abs(ii * n2 - jj * n1) >= dInt) { next[jj] = 0; continue; }
      const remaining = n1 + n2 - ii - jj + 1;
      let v = 0;
      if (ii > 0) v += prob[jj] * ((n1 - ii + 1) / remaining);
      if (jj > 0) v += next[jj - 1] * ((n2 - jj + 1) / remaining);
      next[jj] = v;
    }
    prob = next;
  }
  return Math.min(1, Math.max(0, 1 - prob[n2]));
}

export function twoProportionP(x1: number, n1: number, x2: number, n2: number): number | null {
  if (!(n1 > 0 && n2 > 0) || x1 < 0 || x2 < 0 || x1 > n1 || x2 > n2) return null;
  const p1 = x1 / n1, p2 = x2 / n2, pool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  if (se === 0) return p1 === p2 ? null : 0;
  return twoSidedZ((p1 - p2) / se);
}

export function binomTestP(k: number, n: number, p0: number): number | null {
  const K = Math.round(k), N = Math.round(n);
  if (!(N >= 1) || K < 0 || K > N || !(p0 >= 0 && p0 <= 1)) return null;
  if (p0 === 0) return K === 0 ? 1 : 0;
  if (p0 === 1) return K === N ? 1 : 0;
  const pmf = (x: number): number => Math.exp(lnCombin(N, x) + x * Math.log(p0) + (N - x) * Math.log(1 - p0));
  const pObs = pmf(K);
  let p = 0;
  for (let x = 0; x <= N; x++) { const px = pmf(x); if (px <= pObs * (1 + 1e-7)) p += px; }
  return Math.min(1, p);
}
