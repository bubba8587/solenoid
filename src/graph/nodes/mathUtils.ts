// Numerical analysis helpers shared across statistical distribution nodes.
// All functions are pure and domain-checked — return NaN for invalid inputs.

// ─── Clamp ────────────────────────────────────────────────────────────────────
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── Min / max over an iterable ───────────────────────────────────────────────
// Use these instead of `Math.min(...arr)` / `Math.max(...arr)` on user data:
// the spread form passes every element as a function argument and throws
// RangeError("too many arguments") past ~125k elements, so a large list (e.g. a
// big SEQUENCE) into Aggregate(min) would black out the app during render. These
// loop instead, accept any iterable (incl. a Map's .values()), and return
// ±Infinity for an empty input — exactly matching `Math.min()` / `Math.max()`.
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
    // Series expansion
    let term = 1 / a, sum = term;
    for (let i = 1; i <= 300; i++) {
      term *= x / (a + i);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)));
  } else {
    // Lentz continued fraction for upper incomplete gamma; subtract from 1
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

// Regularized incomplete beta I_x(a, b) via Lentz continued fraction.
// Uses symmetry relation I_x(a,b) = 1 - I_{1-x}(b,a) to stay in the
// convergent region (x < (a+1)/(a+b+2)).
export function regularizedBeta(x: number, a: number, b: number): number {
  if (a <= 0 || b <= 0 || x < 0 || x > 1) return NaN;
  if (x === 0) return 0;
  if (x === 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - regularizedBeta(1 - x, b, a);
  const lbeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;
  // Lentz CF
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

// Standard normal CDF Φ(z) via erf (A&S 7.1.26 approximation, max err ≈1.5e-7).
// Φ(z) = ½(1 + erf(z/√2)); the erf approximation takes the scaled argument
// |z|/√2, so the √2 must be applied to z before tabulating — not doing so was a
// bug that made Φ(1.96) read 0.997 instead of 0.975.
function stdNormCDF(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = (z < 0 ? -1 : 1) * (1 - p * Math.exp(-x * x));
  return (1 + erf) / 2;
}

// Inverse standard normal CDF (Peter Acklam's rational approximation,
// |ε| < 1.15e-9 over (0, 1)).
export function normSInv(p: number): number {
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

// ─── Standard normal CDF (exported for nodes that need it directly) ────────────
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

/** Least-squares line through paired data — the shared core of FORECAST.LINEAR
 *  (and the same fit SLOPE/INTERCEPT/RSQ describe). Null when there are fewer
 *  than two points or the Xs have zero variance (the fit divides by SSxx and is
 *  undefined); each surface tags its own error from that, so this stays pure —
 *  the node returns #DIV/0!, the formula returns the same via its registration.
 *  Ragged inputs use the min-length zip, matching the paired-range policy. */
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

// ─── Piecewise-linear interpolation ───────────────────────────────────────────
// Lives here, not in stats.ts, for the same reason textOps/listOps do: the formula
// registration (INTERPOLATE) needs it and must not drag rete + the socket lattice in.

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

// 1-D piecewise-linear interpolation over a known (x, y) dataset. Points are sorted
// by x (known data may arrive unordered); a duplicated x resolves to its first-seen y
// (via bracket's t=0). A NaN query stays NaN. Clamped at the ends.
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
// The T.TEST / F.TEST / PROB nodes and the formula registrations both call these
// (FX-1): Formula.js's own T.TEST ignores `tails`/`type` entirely and its F.TEST
// returns the variance RATIO instead of the p-value, so dispatching to it shipped
// a different answer than the node under the same name.
import { isSolError, type SolError as StatSolError } from "../errorValue";

type StatCell = number | null | StatSolError;

export function arrMean(arr: readonly number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function arrSampleVar(arr: readonly number[]): number {
  const m = arrMean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

/** Student-t CDF via the regularized incomplete beta. */
export function tCDF(x: number, df: number): number {
  const z = df / (df + x * x);
  const betaCDF = regularizedBeta(z, df / 2, 0.5);
  return x >= 0 ? 1 - betaCDF / 2 : betaCDF / 2;
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
