// Numerical analysis helpers shared across statistical distribution nodes.
// All functions are pure and domain-checked — return NaN for invalid inputs.

// ─── Clamp ────────────────────────────────────────────────────────────────────
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── Min / max over an iterable ───────────────────────────────────────────────
// Use these on user data, never `Math.min(...arr)`: the spread form throws
// RangeError past ~125k elements. Empty input gives ±Infinity, matching Math.min().
export function iterMin(it: Iterable<number>): number {
  let m = Infinity;
  for (const v of it) if (v < m) m = v;
  return m;
}
export function iterMax(it: Iterable<number>): number {
  let m = -Infinity;
  for (const v of it) if (v > m) m = v;
  return m;
}

// ─── Gamma / Beta ─────────────────────────────────────────────────────────────

// Natural log of the gamma function (Lanczos g=7 approximation).
export function lnGamma(x: number): number {
  if (x <= 0) return Infinity;
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
             771.32342877765313, -176.61502916214059, 12.507343278686905,
             -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i <= g + 1; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Regularized lower incomplete gamma P(a, x) = γ(a,x)/Γ(a).
// Series for x < a+1; continued fraction (Lentz) for x ≥ a+1.
export function regularizedGamma(a: number, x: number): number {
  if (a <= 0 || x < 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    let term = 1 / a, sum = term;
    for (let i = 1; i <= 300; i++) {
      term *= x / (a + i);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)));
  } else {
    let b = x + 1 - a, c = 1 / 1e-30, d = 1 / b, h = d;
    for (let i = 1; i <= 300; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  }
}

// Regularized incomplete beta I_x(a, b) via Lentz continued fraction, using
// I_x(a,b) = 1 - I_{1-x}(b,a) to stay in the convergent region.
export function regularizedBeta(x: number, a: number, b: number): number {
  if (a <= 0 || b <= 0 || x < 0 || x > 1) return NaN;
  if (x === 0) return 0;
  if (x === 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - regularizedBeta(1 - x, b, a);
  const lbeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;
  let f = 1, cf = 1, df = 1 - (a + b) * x / (a + 1);
  if (Math.abs(df) < 1e-30) df = 1e-30;
  df = 1 / df; f = df;
  for (let m = 1; m <= 300; m++) {
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    df = 1 + num * df; if (Math.abs(df) < 1e-30) df = 1e-30;
    cf = 1 + num / cf; if (Math.abs(cf) < 1e-30) cf = 1e-30;
    df = 1 / df; f *= df * cf;
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    df = 1 + num * df; if (Math.abs(df) < 1e-30) df = 1e-30;
    cf = 1 + num / cf; if (Math.abs(cf) < 1e-30) cf = 1e-30;
    df = 1 / df;
    const delta = df * cf; f *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return front * f;
}

// ─── Normal distribution ──────────────────────────────────────────────────────

// Standard normal CDF Φ(z) — W. J. Cody's rational Chebyshev algorithm (ACM TOMS 715,
// the one R's pnorm runs): three ranges, relative error at double precision, exact 0.5
// at z = 0, and a tail that stays accurate where an erf-based form underflows.
const CODY_A = [2.2352520354606839287, 161.02823106855587881, 1067.6894854603709582, 18154.981253343561249, 0.065682337918207449113];
const CODY_B = [47.20258190468824187, 976.09855173777669322, 10260.932208618978205, 45507.789335026729956];
const CODY_C = [0.39894151208813466764, 8.8831497943883759412, 93.506656132177855979, 597.27027639480026226, 2494.5375852903726711, 6848.1904505362823326, 11602.651437647350124, 9842.7148383839780218, 1.0765576773720192317e-8];
const CODY_D = [22.266688044328115691, 235.38790178262499861, 1519.377599407554805, 6485.558298266760755, 18615.571640885098091, 34900.952721145977266, 38912.003286093271411, 19685.429676859990727];
const CODY_P = [0.21589853405795699, 0.1274011611602473639, 0.022235277870649807, 0.001421619193227893466, 2.9112874951168792e-5, 0.02307344176494017303];
const CODY_Q = [1.28426009614491121, 0.468238212480865118, 0.0659881378689285515, 0.00378239633202758244, 7.29751555083966205e-5];
const M_1_SQRT_2PI = 0.398942280401432677939946059934;
function stdNormCDF(z: number): number {
  if (Number.isNaN(z)) return NaN;
  const y = Math.abs(z);
  if (y <= 0.67448975) {
    let xnum = 0, xden = 0;
    if (y > 1e-16) {
      const xsq = z * z;
      xnum = CODY_A[4] * xsq; xden = xsq;
      for (let i = 0; i < 3; i++) { xnum = (xnum + CODY_A[i]) * xsq; xden = (xden + CODY_B[i]) * xsq; }
    }
    return 0.5 + z * (xnum + CODY_A[3]) / (xden + CODY_B[3]);
  }
  let lower: number;
  if (y <= Math.sqrt(32)) {
    let xnum = CODY_C[8] * y, xden = y;
    for (let i = 0; i < 7; i++) { xnum = (xnum + CODY_C[i]) * y; xden = (xden + CODY_D[i]) * y; }
    const temp = (xnum + CODY_C[7]) / (xden + CODY_D[7]);
    const xsq = Math.trunc(y * 16) / 16, del = (y - xsq) * (y + xsq);
    lower = Math.exp(-xsq * xsq * 0.5) * Math.exp(-del * 0.5) * temp;
  } else {
    const xsq0 = 1 / (z * z);
    let xnum = CODY_P[5] * xsq0, xden = xsq0;
    for (let i = 0; i < 4; i++) { xnum = (xnum + CODY_P[i]) * xsq0; xden = (xden + CODY_Q[i]) * xsq0; }
    let temp = xsq0 * (xnum + CODY_P[4]) / (xden + CODY_Q[4]);
    temp = (M_1_SQRT_2PI - temp) / y;
    const xsq = Math.trunc(y * 16) / 16, del = (y - xsq) * (y + xsq);
    lower = Math.exp(-xsq * xsq * 0.5) * Math.exp(-del * 0.5) * temp;
  }
  // `lower` is the tail mass beyond |z|: Φ(z) for z < 0, 1 − Φ(z) for z > 0.
  return z < 0 ? lower : 1 - lower;
}

// Inverse standard normal CDF: Peter Acklam's rational approximation (|ε| < 1.15e-9)
// refined by one Halley step against the double-precision Φ above — full precision.
export function normSInv(p: number): number {
  const x = normSInvAcklam(p);
  if (!Number.isFinite(x)) return x;
  const e = stdNormCDF(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}
function normSInvAcklam(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01,  2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00,  4.374664141464968e+00,  2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

export { stdNormCDF };

// ─── Generic inverse CDF via bisection ───────────────────────────────────────
// Assumes cdf is monotone non-decreasing over [lo, hi].
export function bisectionInv(
  cdf: (x: number) => number,
  p: number,
  lo: number,
  hi: number,
  eps = 1e-10,
): number {
  if (p <= 0) return lo;
  if (p >= 1) return hi;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (hi - lo < eps) break;
    if (cdf(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ─── Combinatorics helpers ────────────────────────────────────────────────────

export function lnFactorial(n: number): number {
  return lnGamma(n + 1);
}

export function lnCombin(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k);
}

/** Least-squares line through paired data — null when there are fewer than two
 *  points or the Xs have zero variance, so each surface tags its own error;
 *  ragged inputs use the min-length zip. */
export function linearFit(
  xs: ReadonlyArray<number>, ys: ReadonlyArray<number>,
): { slope: number; intercept: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let xMean = 0, yMean = 0;
  for (let i = 0; i < n; i++) { xMean += xs[i]; yMean += ys[i]; }
  xMean /= n; yMean /= n;
  let SSxy = 0, SSxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    SSxy += dx * (ys[i] - yMean);
    SSxx += dx * dx;
  }
  if (SSxx === 0) return null;
  const slope = SSxy / SSxx;
  return { slope, intercept: yMean - slope * xMean };
}

/** `linearFit` plus R² in one pass; R² is 0 when Y has zero variance. */
export function linearFitR2(
  xs: ReadonlyArray<number>, ys: ReadonlyArray<number>,
): { slope: number; intercept: number; r2: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let xMean = 0, yMean = 0;
  for (let i = 0; i < n; i++) { xMean += xs[i]; yMean += ys[i]; }
  xMean /= n; yMean /= n;
  let SSxy = 0, SSxx = 0, SSyy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean, dy = ys[i] - yMean;
    SSxy += dx * dy; SSxx += dx * dx; SSyy += dy * dy;
  }
  if (SSxx === 0) return null;
  const slope = SSxy / SSxx;
  const r2 = (SSxx > 0 && SSyy > 0) ? (SSxy / Math.sqrt(SSxx * SSyy)) ** 2 : 0;
  return { slope, intercept: yMean - slope * xMean, r2 };
}

/** Exponential fit y = b·mˣ by least squares in log space; null when the ln(y)
 *  fit is undefined or any y ≤ 0. */
export function expFit(
  xs: ReadonlyArray<number>, ys: ReadonlyArray<number>,
): { m: number; b: number } | null {
  const n = Math.min(xs.length, ys.length);
  const ySlice = ys.slice(0, n);
  if (!ySlice.every((y) => y > 0)) return null;
  const fit = linearFit(xs.slice(0, n), ySlice.map(Math.log));
  if (!fit) return null;
  return { m: Math.exp(fit.slope), b: Math.exp(fit.intercept) };
}

// ─── Piecewise-linear interpolation ───────────────────────────────────────────
// Lives here so the INTERPOLATE registration doesn't drag rete in.

function bracket(axis: number[], x: number): [number, number, number] {
  const last = axis.length - 1;
  if (x <= axis[0]) return [0, 0, 0];
  if (x >= axis[last]) return [last, last, 0];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] <= x) lo = mid; else hi = mid;
  }
  const x0 = axis[lo], x1 = axis[hi];
  return [lo, hi, x1 === x0 ? 0 : (x - x0) / (x1 - x0)]; // x1===x0: duplicated key, no gap
}

// Points are sorted by x, a duplicated x resolves to its first-seen y, a NaN query
// stays NaN, and the ends clamp.
export function interpolateLinear(xs: number[], ys: number[], queryXs: number[]): number[] {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return queryXs.map(() => NaN);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) pairs.push([xs[i], ys[i]]);
  pairs.sort((a, b) => a[0] - b[0]);
  const sx = pairs.map((p) => p[0]);
  const sy = pairs.map((p) => p[1]);
  return queryXs.map((x) => {
    if (Number.isNaN(x)) return NaN;
    const [i0, i1, t] = bracket(sx, x);
    return sy[i0] + t * (sy[i1] - sy[i0]);
  });
}

// ─── Shared statistical-test implementations (ONE impl, two surfaces) ─────────
// Node and formula both call these (shareImpl): Formula.js's T.TEST ignores
// `tails`/`type` and its F.TEST returns the variance RATIO, not the p-value.
import { isSolError, type SolError as StatSolError } from "../errorValue";

type StatCell = number | null | StatSolError;

export function arrMean(arr: readonly number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function arrSampleVar(arr: readonly number[]): number {
  const m = arrMean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

// ─── Continuous-distribution kernels (shareImpl) ──────────────────────────────
// ONE home for the t / chi-squared / F / gamma CDFs and PDFs that Formula.js lacks.
// The in-formula registrations (excelFunctions.ts) AND the Distribution node
// (distribution.ts) both call these, so the two surfaces cannot drift — the CDFs also
// back every inverse form via `bisectionInv`. Kept numerically identical to the three
// hand-rolled copies they replaced (t/chisq/F/gamma parity is pinned cross-surface).

/** Student-t CDF via the regularized incomplete beta. */
export function tCDF(x: number, df: number): number {
  const z = df / (df + x * x);
  const betaCDF = regularizedBeta(z, df / 2, 0.5);
  return x >= 0 ? 1 - betaCDF / 2 : betaCDF / 2;
}

/** Student-t PDF. */
export function tPDF(x: number, df: number): number {
  return Math.exp(lnGamma((df + 1) / 2) - lnGamma(df / 2)) /
    (Math.sqrt(df * Math.PI) * Math.pow(1 + (x * x) / df, (df + 1) / 2));
}

/** Chi-squared CDF (0 at or below the origin). */
export function chiSqCDF(x: number, df: number): number {
  return x <= 0 ? 0 : regularizedGamma(df / 2, x / 2);
}

/** F-distribution CDF (0 at or below the origin). */
export function fCDF(x: number, df1: number, df2: number): number {
  return x <= 0 ? 0 : regularizedBeta((x * df1) / (x * df1 + df2), df1 / 2, df2 / 2);
}

/** Gamma CDF with a SCALE parameter (Excel's β), 0 at or below the origin. */
export function gammaCDF(x: number, alpha: number, beta: number): number {
  return x <= 0 ? 0 : regularizedGamma(alpha, x / beta);
}

/** Gamma PDF with a SCALE parameter (Excel's β), 0 at or below the origin. */
export function gammaPDF(x: number, alpha: number, beta: number): number {
  return x <= 0 ? 0 : Math.exp((alpha - 1) * Math.log(x) - x / beta - alpha * Math.log(beta) - lnGamma(alpha));
}

/** Index-aligned pairs with the pairwise policy: first cell error propagates,
 *  a pair with a missing side is dropped, ragged tails truncate. */
export function pairPresent(
  xsRaw: readonly StatCell[] | null,
  ysRaw: readonly StatCell[] | null,
): { error?: StatSolError; xs: number[]; ys: number[] } {
  const xs = xsRaw ?? [], ys = ysRaw ?? [];
  for (const v of xs) if (isSolError(v)) return { error: v, xs: [], ys: [] };
  for (const v of ys) if (isSolError(v)) return { error: v, xs: [], ys: [] };
  const n = Math.min(xs.length, ys.length);
  const ox: number[] = [], oy: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = xs[i], b = ys[i];
    if (a === null || b === null) continue;
    ox.push(a as number); oy.push(b as number);
  }
  return { xs: ox, ys: oy };
}

export type TTestKind = "paired" | "equal-var" | "unequal-var";

/** Two-tailed Student-t p-value for two samples, by test kind. Returns null when
 *  the test is undefined (short samples, zero variance, non-finite t/df). */
export function tTestP(kind: TTestKind, a: readonly number[], b: readonly number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  let t: number, df: number;
  if (kind === "paired") {
    const n = Math.min(a.length, b.length);
    const diffs = Array.from({ length: n }, (_, i) => a[i] - b[i]);
    const dVar = arrSampleVar(diffs);
    if (dVar <= 0) return null;
    t = arrMean(diffs) / Math.sqrt(dVar / n);
    df = n - 1;
  } else if (kind === "equal-var") {
    const n1 = a.length, n2 = b.length;
    const v1 = arrSampleVar([...a]), v2 = arrSampleVar([...b]);
    const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
    if (sp2 <= 0) return null;
    t = (arrMean(a) - arrMean(b)) / Math.sqrt(sp2 * (1 / n1 + 1 / n2));
    df = n1 + n2 - 2;
  } else {
    const n1 = a.length, n2 = b.length;
    const v1n = arrSampleVar([...a]) / n1, v2n = arrSampleVar([...b]) / n2;
    const sum = v1n + v2n;
    if (sum <= 0) return null;
    t = (arrMean(a) - arrMean(b)) / Math.sqrt(sum);
    df = sum ** 2 / (v1n ** 2 / (n1 - 1) + v2n ** 2 / (n2 - 1));
  }
  if (!(df > 0) || !Number.isFinite(t) || !Number.isFinite(df)) return null;
  const p = 2 * (1 - tCDF(Math.abs(t), df));
  return Number.isFinite(p) ? clamp(p, 0, 1) : null;
}

/** Excel F.TEST: the TWO-TAILED p-value that the samples' variances differ —
 *  not the variance ratio (which is what Formula.js returns). */
export function fTestP(a: readonly number[], b: readonly number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const v1 = arrSampleVar([...a]), v2 = arrSampleVar([...b]);
  if (!(v1 > 0) || !(v2 > 0)) return null;
  const F = v1 / v2;
  const df1 = a.length - 1, df2 = b.length - 1;
  const p1 = regularizedBeta((F * df1) / (F * df1 + df2), df1 / 2, df2 / 2);
  const p = 2 * Math.min(p1, 1 - p1);
  return Number.isFinite(p) ? p : null;
}

/** Excel PROB over a 1-D range: total probability of values in [lo, hi].
 *  Pairwise cell policy: an error propagates, a pair missing either side drops. */
export function probBetween(
  range: readonly StatCell[] | null,
  probs: readonly StatCell[] | null,
  lo: number,
  hi: number,
): number | StatSolError | null {
  const { error, xs, ys } = pairPresent(range, probs);
  if (error) return error;
  if (xs.length === 0) return null;
  let prob = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] >= lo && xs[i] <= hi) prob += ys[i];
  }
  return Number.isFinite(prob) ? clamp(prob, 0, 1) : null;
}


// ─── Bilinear lookup-table fill (INTERPOLATE grid mode) ──────────────────────
// Lives here, not nodes/stats.ts, because the formula path must stay rete-free (implReteFree).
import { fitSurface, type FitPoint } from "./surfaceFit";

// Fill a coordinate-BORDERED grid's blank interior by bilinear interpolation over
// the closest all-known-corner box, then (unless `forecast` is off) fill whatever
// is left from a surface fitted through ALL known points.
export function fillBorderedGrid(table: (number | null)[][], forecast = true): (number | null)[][] {
  const R = table.length;
  const C = R > 0 ? Math.max(...table.map((r) => r.length)) : 0;
  const isKnown = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
  // Rectangular working copy; a blank (null / non-finite) cell becomes `null`.
  const g: (number | null)[][] = Array.from({ length: R }, (_, i) =>
    Array.from({ length: C }, (_, j) => { const v = table[i]?.[j]; return isKnown(v) ? v : null; }),
  );
  if (R < 2 || C < 2) { if (g[0]) g[0][0] = null; return g; } // no interior to fill

  const colXs = g[0].slice(1).map((v) => (v == null ? NaN : v));    // X of each interior column
  const rowYs = g.slice(1).map((r) => (r[0] == null ? NaN : r[0])); // Y of each interior row
  const Ri = R - 1, Ci = C - 1;
  const Z: (number | null)[][] = g.slice(1).map((r) => r.slice(1)); // interior values

  const out: (number | null)[][] = g.map((r) => [...r]);
  out[0][0] = null; // corner always blank on output

  // The coarse grid: interior columns/rows that carry ≥1 known value (a blank INSERTED
  // line has none).
  const coarseCols: number[] = [];
  for (let j = 0; j < Ci; j++) if (!Number.isNaN(colXs[j]) && Z.some((row) => row[j] != null)) coarseCols.push(j);
  const coarseRows: number[] = [];
  for (let i = 0; i < Ri; i++) if (!Number.isNaN(rowYs[i]) && Z[i].some((v) => v != null)) coarseRows.push(i);

  // Bracketing data lines, nearest first; null when the query sits past the data on
  // that axis, so the cell can't be ENCLOSED.
  const sides = (lines: number[], coordOf: (k: number) => number, q: number): [number[], number[]] | null => {
    const lo = lines.filter((k) => coordOf(k) <= q).sort((a, b) => coordOf(b) - coordOf(a));
    const hi = lines.filter((k) => coordOf(k) >= q).sort((a, b) => coordOf(a) - coordOf(b));
    if (lo.length === 0 || hi.length === 0) return null;
    return [lo, hi];
  };

  // Every labeled known point, for pass 1's containment test and pass 2's fit.
  const knownPts: Array<{ x: number; y: number; i: number; j: number; z: number }> = [];
  for (let i = 0; i < Ri; i++) for (let j = 0; j < Ci; j++) {
    const v = Z[i][j];
    if (v != null && !Number.isNaN(colXs[j]) && !Number.isNaN(rowYs[i])) {
      knownPts.push({ x: colXs[j], y: rowYs[i], i, j, z: v });
    }
  }

  // ── Pass 1 — bilinear interpolation for cells ENCLOSED by known data. ──
  for (let i = 0; i < Ri; i++) for (let j = 0; j < Ci; j++) {
    if (Z[i][j] != null) { out[i + 1][j + 1] = Z[i][j]; continue; } // known passes through
    const qx = colXs[j], qy = rowYs[i];
    if (Number.isNaN(qx) || Number.isNaN(qy)) continue; // unlabelled line → stays blank
    const rs = sides(coarseRows, (k) => rowYs[k], qy);
    const cs = sides(coarseCols, (k) => colXs[k], qx);
    if (!rs || !cs) continue; // not enclosable → leave for the forecast pass
    // The widening depth MUST stay capped: un-capped, scattered data rejects every
    // box and the four nested loops exhaust O(lines⁴) combinations per cell.
    const WIDEN = 4;
    const [rLoC, rHiC] = [rs[0].slice(0, WIDEN), rs[1].slice(0, WIDEN)];
    const [cLoC, cHiC] = [cs[0].slice(0, WIDEN), cs[1].slice(0, WIDEN)];
    // Widening past blank corners is what lets a hole interpolate across missing
    // samples; the query stays inside the box, so this is pure interpolation.
    search:
    for (const rLo of rLoC) for (const rHi of rHiC) for (const cLo of cLoC) for (const cHi of cHiC) {
      const z00 = Z[rLo][cLo], z01 = Z[rLo][cHi], z10 = Z[rHi][cLo], z11 = Z[rHi][cHi];
      if (z00 == null || z01 == null || z10 == null || z11 == null) continue;
      const x0 = colXs[cLo], x1 = colXs[cHi], y0 = rowYs[rLo], y1 = rowYs[rHi];
      // A CONTESTED box — one with other known data inside it — falls through to the
      // surface fit rather than ignoring that nearer data.
      const xA = Math.min(x0, x1), xB = Math.max(x0, x1);
      const yA = Math.min(y0, y1), yB = Math.max(y0, y1);
      const degenRow = rLo === rHi, degenCol = cLo === cHi;
      let contested = false;
      for (const p of knownPts) {
        if ((p.i === rLo || p.i === rHi) && (p.j === cLo || p.j === cHi)) continue; // a corner
        const hit =
          degenRow && !degenCol ? p.x > xA && p.x < xB :
          degenCol && !degenRow ? p.y > yA && p.y < yB :
          p.x >= xA && p.x <= xB && p.y >= yA && p.y <= yB;
        if (hit) { contested = true; break; }
      }
      if (contested) continue;
      const tx = x1 === x0 ? 0 : (qx - x0) / (x1 - x0);
      const ty = y1 === y0 ? 0 : (qy - y0) / (y1 - y0);
      const top = z00 + tx * (z01 - z00);
      const bot = z10 + tx * (z11 - z10);
      out[i + 1][j + 1] = top + ty * (bot - top);
      break search;
    }
  }

  // ── Pass 2 — Forecast: fill what pass 1 left blank from a fitted surface. ──
  if (forecast) {
    const f = fitSurface(knownPts.map(({ x, y, z }): FitPoint => ({ x, y, z })));
    if (f) for (let i = 0; i < Ri; i++) for (let j = 0; j < Ci; j++) {
      if (out[i + 1][j + 1] != null || Number.isNaN(colXs[j]) || Number.isNaN(rowYs[i])) continue;
      const v = f(colXs[j], rowYs[i]);
      if (Number.isFinite(v)) out[i + 1][j + 1] = v;
    }
  }
  return out;
}

/** All complex roots of a polynomial given HIGHEST-degree-first coefficients
 *  (numpy.roots / R polyroot order), by Durand–Kerner iteration with a Newton polish.
 *  Leading zeros are dropped; a constant (degree 0) has no roots → []. Returns
 *  [re, im] pairs in no particular order, or null when the input is degenerate. */
export function polyRoots(coeffs: readonly number[]): [number, number][] | null {
  let c = [...coeffs];
  while (c.length && c[0] === 0) c.shift();
  if (c.length === 0 || c.some((v) => !Number.isFinite(v))) return null;
  const n = c.length - 1;
  if (n === 0) return [];
  const a = c.map((v) => v / c[0]); // monic
  // evaluate p(z) and p'(z) at complex z by Horner
  const evalP = (zr: number, zi: number): [number, number] => {
    let pr = 1, pi = 0;
    for (let k = 1; k <= n; k++) { const nr = pr * zr - pi * zi + a[k]; const ni = pr * zi + pi * zr; pr = nr; pi = ni; }
    return [pr, pi];
  };
  // initial guesses on a circle (Aberth's), radius from the coefficient bound
  const radius = 1 + Math.max(...a.slice(1).map(Math.abs));
  const roots: [number, number][] = Array.from({ length: n }, (_, k) => {
    const th = (2 * Math.PI * k) / n + 0.4;
    return [radius * Math.cos(th), radius * Math.sin(th)];
  });
  for (let it = 0; it < 500; it++) {
    let maxStep = 0;
    for (let i = 0; i < n; i++) {
      const [zr, zi] = roots[i];
      const [pr, pi] = evalP(zr, zi);
      // denominator Π_{j≠i} (z_i − z_j)
      let dr = 1, di = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const wr = zr - roots[j][0], wi = zi - roots[j][1];
        const nr = dr * wr - di * wi, ni = dr * wi + di * wr; dr = nr; di = ni;
      }
      const den = dr * dr + di * di;
      if (den === 0) { roots[i] = [zr + 1e-6, zi + 1e-6]; continue; }
      const qr = (pr * dr + pi * di) / den, qi = (pi * dr - pr * di) / den;
      roots[i] = [zr - qr, zi - qi];
      maxStep = Math.max(maxStep, Math.hypot(qr, qi));
    }
    if (maxStep < 1e-15) break;
  }
  // Newton polish (p / p′ by Horner) — DK converges linearly near multiple roots
  for (let i = 0; i < n; i++) {
    let [zr, zi] = roots[i];
    for (let k = 0; k < 4; k++) {
      let pr = 1, pi = 0, dr = 0, di = 0;
      for (let j = 1; j <= n; j++) {
        const ndr = dr * zr - di * zi + pr, ndi = dr * zi + di * zr + pi; dr = ndr; di = ndi;
        const npr = pr * zr - pi * zi + a[j], npi = pr * zi + pi * zr; pr = npr; pi = npi;
      }
      const den = dr * dr + di * di;
      if (den === 0) break;
      const qr = (pr * dr + pi * di) / den, qi = (pi * dr - pr * di) / den;
      if (!Number.isFinite(qr) || !Number.isFinite(qi) || Math.hypot(qr, qi) > 1e-3 * Math.max(1, Math.hypot(zr, zi))) break; // only polish, never wander
      zr -= qr; zi -= qi;
    }
    roots[i] = [zr, zi];
  }
  // clean: snap tiny imaginary parts / components relative to the root's size
  return roots.map(([r, i]) => {
    const scale = Math.max(1, Math.hypot(r, i));
    return [Math.abs(r) < 1e-12 * scale ? 0 : r, Math.abs(i) < 1e-10 * scale ? 0 : i];
  });
}
