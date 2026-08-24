// The ONE implementation behind the statistics NODES (Aggregate, Rank & Percentile,
// Correl, Covariance, Mode) AND their formula registrations (capabilityParity /
// shareImpl). Must not import rete. Inputs are the already-prepared numbers — the
// caller has applied the aggregator policy (an error propagates, a blank is skipped;
// `forAggregate` / `pairPresent` on the node side, `prepRangeArgs` on the formula side).
// `null` = undefined for this input (too few points, a flat list) — each surface shows
// that as a blank; a SolError is a real domain failure both surfaces display as-is.
import { solError, type SolError } from "../errorValue";
import { iterMin, iterMax, stdNormCDF, fCDF, chiSqCDF, lnCombin } from "./mathUtils";

export type AggregateOp =
  | "sum" | "avg" | "min" | "max" | "count" | "countdistinct" | "median" | "product" | "stdev"
  | "geomean" | "harmean" | "sumsq" | "var_s" | "var_p" | "stdev_p" | "devsq" | "avedev" | "skew" | "skew_p" | "kurt"
  | "ptp" | "iqr" | "mad" | "sem" | "cv" | "rms" | "first" | "last";

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: readonly number[]) => sum(a) / a.length;
const ssd = (a: readonly number[], m: number) => a.reduce((x, y) => x + (y - m) ** 2, 0);

/** The Aggregate node's reducers over PRESENT numbers (blanks already skipped). An empty
 *  list answers the op's identity for SUM (0) / PRODUCT (1) / COUNT (0) and `null` for
 *  everything else; a sample statistic under its minimum n is `null` — "not enough data"
 *  is a blank, not an error (the Running node's rule too; Excel says #DIV/0!) — as are the
 *  normalized moments of a flat list. GEOMEAN/HARMEAN over a non-positive value is a real
 *  log-domain failure: #DOMAIN!. */
export function aggregate(op: AggregateOp, arr: readonly number[]): number | SolError | null {
  if (arr.length === 0) return op === "sum" || op === "count" ? 0 : op === "product" ? 1 : null;
  const n = arr.length;
  switch (op) {
    case "sum":     return sum(arr);
    case "avg":     return mean(arr);
    case "min":     return iterMin(arr);
    case "max":     return iterMax(arr);
    case "count":   return n;
    case "countdistinct": return new Set(arr).size;
    // Blanks are already skipped by the caller, so these ARE the first / last non-blank.
    case "first":   return arr[0];
    case "last":    return arr[n - 1];
    case "product": return arr.reduce((a, b) => a * b, 1);
    case "median": {
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
    }
    case "stdev":   return n < 2 ? null : Math.sqrt(ssd(arr, mean(arr)) / (n - 1));
    case "stdev_p": return Math.sqrt(ssd(arr, mean(arr)) / n);
    case "var_s":   return n < 2 ? null : ssd(arr, mean(arr)) / (n - 1);
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
    // The numpy / pandas / R one-liners (python-r-gap.md Tier 1 #5).
    case "ptp":  return iterMax(arr) - iterMin(arr);                                   // numpy ptp, R diff(range(x))
    case "iqr": {                                                                       // scipy iqr, R IQR — PERCENTILE.INC quartiles
      const s = [...arr].sort((a, b) => a - b);
      return percentileOf(s, 0.75, false) - percentileOf(s, 0.25, false);
    }
    case "mad": {                                                                       // median absolute deviation, UNSCALED (scipy; R's mad scales ×1.4826)
      const med = aggregate("median", arr) as number;
      return aggregate("median", arr.map((v) => Math.abs(v - med))) as number;
    }
    case "sem":  return n < 2 ? null : Math.sqrt(ssd(arr, mean(arr)) / (n - 1)) / Math.sqrt(n); // scipy sem, R sd/sqrt(n)
    case "cv": {                                                                        // coefficient of variation sd/mean (sample sd)
      if (n < 2) return null;
      const m = mean(arr);
      return m === 0 ? solError("#DIV/0!", "CV is undefined when the mean is 0") : Math.sqrt(ssd(arr, m) / (n - 1)) / m;
    }
    case "rms":  return Math.sqrt(arr.reduce((a, b) => a + b * b, 0) / n);             // root mean square
  }
}

/** The interpolating percentile over a SORTED list; `exc` uses Excel's exclusive rank. */
export function percentileOf(sorted: readonly number[], p: number, exc: boolean): number {
  const n = sorted.length;
  const i = exc ? p * (n + 1) - 1 : p * (n - 1);
  const lo = Math.floor(i), hi = exc ? Math.min(n - 1, Math.ceil(i)) : Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** PERCENTILE.INC / .EXC with Excel's domain rules: INC needs 0 ≤ p ≤ 1, EXC needs p
 *  strictly inside (1/(n+1), n/(n+1)) — Excel answers #NUM! outside (our #DOMAIN!). */
export function percentile(arr: readonly number[], p: number, exc: boolean): number | SolError | null {
  const n = arr.length;
  if (n === 0) return null;
  if (!exc && (p < 0 || p > 1)) return solError("#DOMAIN!", "Percentile must be between 0 and 1");
  if (exc && (p < 1 / (n + 1) || p > n / (n + 1))) {
    return solError("#DOMAIN!", "Percentile is outside the EXC domain: it must lie strictly between 1/(n+1) and n/(n+1)");
  }
  return percentileOf([...arr].sort((a, b) => a - b), p, exc);
}

/** QUARTILE.INC / .EXC = PERCENTILE at q/4; INC's quart 0 = MIN and 4 = MAX, EXC has
 *  neither (and an interior q can still leave the EXC domain at small n). */
export function quartile(arr: readonly number[], q: number, exc: boolean): number | SolError | null {
  const qi = Math.round(q);
  if (arr.length === 0) return null;
  if (qi < 0 || qi > 4) return solError("#DOMAIN!", "Quartile must be 0, 1, 2, 3, or 4");
  if (exc && (qi === 0 || qi === 4)) return solError("#DOMAIN!", "QUARTILE.EXC is undefined for quartile 0 or 4");
  const n = arr.length, p = qi / 4;
  if (exc && (p < 1 / (n + 1) || p > n / (n + 1))) {
    return solError("#DOMAIN!", "Quartile is outside the EXC domain: q/4 must lie between 1/(n+1) and n/(n+1)");
  }
  return percentileOf([...arr].sort((a, b) => a - b), p, exc);
}

/** LARGE / SMALL: the k-th largest (or smallest), 1-based; out of range is `null`. */
export function nthExtreme(arr: readonly number[], k: number, largest: boolean): number | null {
  const ki = Math.round(k);
  if (arr.length === 0 || ki < 1 || ki > arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return largest ? sorted[arr.length - ki] : sorted[ki - 1];
}

/** Pearson r (or r², `rsq`) over PAIRED numbers — the caller has already dropped pairs
 *  with a blank. Fewer than two pairs is `null`; zero variance in either list is #DIV/0!. */
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
  return rsq ? r * r : r;
}

/** Average ranks (ties share the mean rank) — the rank transform under Spearman. */
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

/** Spearman's ρ: Pearson over the average ranks (scipy spearmanr, R cor(method="spearman")). */
export function spearman(xs: readonly number[], ys: readonly number[]): number | SolError | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  return pearson(averageRanks(xs.slice(0, n)), averageRanks(ys.slice(0, n)));
}

/** Kendall's τ-b (tie-corrected; scipy kendalltau, R cor(method="kendall")). O(n²) — fine
 *  for list sizes here. All-tied in either list is #DIV/0!. */
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

/** COVARIANCE.P (`sample=false`) / .S over paired numbers; fewer than two pairs is `null`. */
export function covariance(xs: readonly number[], ys: readonly number[], sample: boolean): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = mean(xs.slice(0, n)), my = mean(ys.slice(0, n));
  const cov = xs.slice(0, n).reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  return sample ? cov / (n - 1) : cov / n;
}

/** The mode(s): one mode → that number; a tie → every tied value, ascending (the combo
 *  answer that supersedes Excel's MODE.SNGL / MODE.MULT split). Empty → `null`. */
export function modes(arr: readonly number[]): number | number[] | null {
  if (arr.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = iterMax(counts.values());
  const ms = [...counts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v).sort((a, b) => a - b);
  return ms.length === 1 ? ms[0] : ms;
}

/** FISHER / FISHERINV; FISHER is defined only on (−1, 1). */
export function fisher(x: number, inverse: boolean): number | SolError {
  if (inverse) return Math.tanh(x);
  return x <= -1 || x >= 1 ? solError("#DOMAIN!", "FISHER requires −1 < x < 1") : Math.atanh(x);
}

/** Excel MODE / MODE.SNGL: the most frequent value; among ties the one that occurs FIRST
 *  in the data (Excel's rule). Empty → `null`. The node's `modes` keeps every tie. */
export function modeSingle(arr: readonly number[]): number | null {
  if (arr.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = iterMax(counts.values());
  for (const v of arr) if (counts.get(v) === maxCount) return v;
  return null;
}

/** SLOPE / INTERCEPT / STEYX of the least-squares line over paired numbers. Fewer than
 *  two pairs is `null`; zero X variance is #DIV/0!; STEYX's (n−2) needs three points
 *  (fewer → `null`). Same SS pass as mathUtils.linearFit, plus the residual term. */
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
  if (op === "slope") return slope;
  if (op === "intercept") return yMean - slope * xMean;
  return n >= 3 ? Math.sqrt(Math.max(0, SSyy - slope * SSxy) / (n - 2)) : null;
}

// ─── Hypothesis tests beyond Excel's four (python-r-gap Tier 1 #16) ──────────
// Every kernel answers a two-sided p-value (ANOVA / Kruskal: the upper tail of F / χ²),
// `null` when the data can't support the test (too few points, no variance, an empty
// group). Conventions follow R / scipy where they agree; where they differ the
// description on the op says which.

const twoSidedZ = (z: number): number => 2 * (1 - stdNormCDF(Math.abs(z)));
/** Σ(t³ − t) over the tie groups of a list (rank-test variance corrections). */
function tieTerm(values: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let t = 0;
  for (const c of counts.values()) if (c > 1) t += c ** 3 - c;
  return t;
}

/** One-way ANOVA over k groups: the upper-tail F probability (scipy f_oneway, R aov). */
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

/** Mann–Whitney U (Wilcoxon rank-sum), two-sided, normal approximation with tie and
 *  continuity corrections (R wilcox.test default for larger samples; scipy mannwhitneyu
 *  method="asymptotic", use_continuity=True). */
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

/** Wilcoxon signed-rank (paired), two-sided, zero differences dropped (Wilcoxon's rule),
 *  normal approximation with tie and continuity corrections (R wilcox.test paired). */
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

/** Kruskal–Wallis H over k groups, tie-corrected, χ² upper tail with k−1 df (scipy kruskal, R kruskal.test). */
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

/** Fisher's exact test on a 2×2 table [[a, b], [c, d]], two-sided: the sum of every
 *  table probability no larger than the observed one (R fisher.test, scipy fisher_exact). */
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

/** Two-sample Kolmogorov–Smirnov, two-sided, EXACT (scipy ks_2samp method="exact", R
 *  ks.test exact=TRUE): the probability that a random interleaving of the two samples
 *  keeps every ECDF gap below the observed D — a lattice-path DP on the integer grid, so
 *  no asymptotic approximation is needed for the list sizes a card carries (O(n₁·n₂)). */
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

/** Two-proportion z-test, two-sided, pooled standard error, no continuity correction
 *  (statsmodels proportions_ztest; R prop.test(correct=FALSE)). */
export function twoProportionP(x1: number, n1: number, x2: number, n2: number): number | null {
  if (!(n1 > 0 && n2 > 0) || x1 < 0 || x2 < 0 || x1 > n1 || x2 > n2) return null;
  const p1 = x1 / n1, p2 = x2 / n2, pool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  if (se === 0) return p1 === p2 ? null : 0;
  return twoSidedZ((p1 - p2) / se);
}

/** Exact binomial test of k successes in n at p₀, two-sided: the sum of every outcome
 *  probability no larger than the observed one (scipy binomtest, R binom.test). */
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
