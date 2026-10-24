// [[C17]], [[C102]] gridFillThenForecast (fillBorderedGrid)

// ─── Clamp ────────────────────────────────────────────────────────────────────
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── ROUND / ROUNDUP / ROUNDDOWN ─────────────────────────────────────────────
export type RoundMode = "round" | "roundup" | "rounddown";

// ─── Min / max over an iterable ───────────────────────────────────────────────
// Use these on user data, never `Math.min(...arr)`, whose spread throws RangeError past about 125k elements.
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

export function lnGamma(x: number): number {
  if (x <= 0) return Infinity;
  if (x === 1 || x === 2) return 0;
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

/** Steps the series and continued fractions below may take. They need about the cube root of the shape (1,741 at
 *  1e8, 36k at 1e12), so a fixed 300 stopped short past a million; one that still hasn't converged answers NaN rather
 *  than its partial sum ([[C120]] linearWork). */
const SPECIAL_FN_STEPS = 100_000;

export function regularizedGamma(a: number, x: number): number {
  if (a <= 0 || x < 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    let term = 1 / a, sum = term, i = 1;
    for (; i <= SPECIAL_FN_STEPS; i++) {
      term *= x / (a + i);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
    }
    if (i > SPECIAL_FN_STEPS) return NaN;
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)));
  } else {
    let b = x + 1 - a, c = 1 / 1e-30, d = 1 / b, h = d, i = 1;
    for (; i <= SPECIAL_FN_STEPS; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    if (i > SPECIAL_FN_STEPS) return NaN;
    return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  }
}

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
  let m = 1;
  for (; m <= SPECIAL_FN_STEPS; m++) {
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
  return m > SPECIAL_FN_STEPS ? NaN : front * f;
}

// ─── Normal distribution ──────────────────────────────────────────────────────

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
  return z < 0 ? lower : 1 - lower;
}

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

export type Combinatoric = "fact" | "factdouble" | "combin" | "combina" | "permut" | "multinomial";

export function lnCombin(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k);
}

// ─── Piecewise-linear interpolation ───────────────────────────────────────────

export function arrMean(arr: readonly number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─── Continuous-distribution kernels ([[C17]] shareImpl) ──────────────────────────────

export function tCDF(x: number, df: number): number {
  const z = df / (df + x * x);
  const betaCDF = regularizedBeta(z, df / 2, 0.5);
  return x >= 0 ? 1 - betaCDF / 2 : betaCDF / 2;
}

export function tPDF(x: number, df: number): number {
  return Math.exp(lnGamma((df + 1) / 2) - lnGamma(df / 2)) /
    (Math.sqrt(df * Math.PI) * Math.pow(1 + (x * x) / df, (df + 1) / 2));
}

export function chiSqCDF(x: number, df: number): number {
  return x <= 0 ? 0 : regularizedGamma(df / 2, x / 2);
}

export function fCDF(x: number, df1: number, df2: number): number {
  return x <= 0 ? 0 : regularizedBeta((x * df1) / (x * df1 + df2), df1 / 2, df2 / 2);
}

export function gammaCDF(x: number, alpha: number, beta: number): number {
  return x <= 0 ? 0 : regularizedGamma(alpha, x / beta);
}

export function gammaPDF(x: number, alpha: number, beta: number): number {
  return x <= 0 ? 0 : Math.exp((alpha - 1) * Math.log(x) - x / beta - alpha * Math.log(beta) - lnGamma(alpha));
}

export type TTestKind = "paired" | "equal-var" | "unequal-var";

