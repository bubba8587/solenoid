// The pure distribution table behind the ONE Distribution node AND the distribution
// formulas (shareImpl / capabilityParity): every CDF / PDF / PMF / tail / inverse lives
// here once, on the mathUtils kernels. Must not import rete — excelFunctions.ts registers
// NORM.DIST, BINOM.DIST, … straight on `DIST_SPECS[key].compute`.
import {
  stdNormCDF,
  normSInv,
  regularizedGamma,
  regularizedBeta,
  lnGamma,
  lnCombin,
  bisectionInv,
  tCDF,
  tPDF,
  chiSqCDF,
  fCDF,
  gammaCDF,
  gammaPDF,
} from "./mathUtils";

const { PI, exp, log, sqrt, abs } = Math;

// Every probability distribution behind ONE card (oneDistributionNode): the `op` selector picks
// the distribution, the `form` selector picks the curve (CDF / PDF / PMF / the
// tails) or the inverse (quantile). An inverse form trades the x-style first
// input for a probability; the parameter inputs are the distribution's own.

export type DistForm = "cdf" | "pdf" | "pmf" | "2t" | "rt" | "inv" | "inv2t" | "invrt" | "sample" | "half";

/** An inverse (quantile) form reads a probability; every other form reads an x. */
export const isInverseForm = (form: string): boolean => form.startsWith("inv");

export const DIST_FORM_META = {
  cdf:   { label: "CDF",        description: "Cumulative probability that X ≤ x" },
  pdf:   { label: "PDF",        description: "Probability density" },
  pmf:   { label: "PMF",        description: "Probability of exactly k" },
  "2t":  { label: "2T",         description: "Two-tailed probability" },
  rt:    { label: "RT",         description: "Right-tail probability" },
  inv:   { label: "Inverse",    description: "The value at cumulative probability p, the quantile" },
  inv2t: { label: "Inverse 2T", description: "The positive value with two-tailed probability p" },
  invrt: { label: "Inverse RT", description: "The value at right-tail probability p" },
  sample: { label: "Sample",    description: "N random draws from the distribution, re-rolled on each recalculation. numpy.random, R rnorm / rgamma" },
  half:   { label: "Φ − ½",     description: "Area under the standard normal curve from 0 to x" },
} satisfies Record<DistForm, { label: string; description: string }>;

export type DistKey =
  | "normal" | "normal-s" | "phi" | "gauss" | "t" | "chisq" | "f" | "beta" | "gamma" | "lognorm"
  | "weibull" | "expon" | "binom" | "poisson" | "hypgeom" | "negbinom";

export interface DistSpec {
  label: string;
  group: "Continuous" | "Discrete";
  /** Excel names, for the dropdown tooltip. */
  excel: string;
  forms: readonly DistForm[];  // first entry is the default
  xKey: string;
  xLabel: string;
  xDefault: number;
  probLabel?: string;          // inverse-mode first-input label; default "Probability"
  params: ReadonlyArray<{ key: string; label: string; def: number }>;
  /** The kernel: form + first value + params in declared order. `broadcast`
   *  guards finiteness centrally; return null for a domain refusal. */
  compute: (form: DistForm, v: number, p: number[]) => number | null;
}

function binomPmf(k: number, n: number, p: number): number | null {
  k = Math.floor(k);
  n = Math.floor(n);
  if (k < 0 || k > n || p < 0 || p > 1) return null;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return exp(lnCombin(n, k) + k * log(p) + (n - k) * log(1 - p));
}

function binomCdf(k: number, n: number, p: number): number | null {
  k = Math.floor(k);
  n = Math.floor(n);
  if (k < 0 || n < 0 || p < 0 || p > 1) return null;
  if (k >= n) return 1;
  if (p === 0) return 1;
  if (p === 1) return k >= n ? 1 : 0;
  // regularizedBeta(1-p, n-k, k+1) = I_{1-p}(n-k, k+1) = P(X <= k)
  const r = regularizedBeta(1 - p, n - k, k + 1);
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : null;
}

function hypgeomPmf(k: number, n: number, M: number, N: number): number | null {
  k = Math.floor(k); n = Math.floor(n); M = Math.floor(M); N = Math.floor(N);
  const lo = Math.max(0, n + M - N);
  const hi = Math.min(n, M);
  if (k < lo || k > hi || N <= 0 || M < 0 || n < 0 || M > N || n > N) return null;
  return exp(lnCombin(M, k) + lnCombin(N - M, n - k) - lnCombin(N, n));
}

const probGuard = (v: number): boolean => v > 0 && v < 1;

export const DIST_SPECS: Record<DistKey, DistSpec> = {
  normal: {
    label: "Normal", group: "Continuous", excel: "NORM.DIST / NORM.INV",
    forms: ["cdf", "pdf", "inv", "sample"], xKey: "x", xLabel: "X", xDefault: 0,
    params: [{ key: "mean", label: "Mean", def: 0 }, { key: "stdev", label: "Stdev", def: 1 }],
    compute: (form, v, [mv, sv]) => {
      if (sv <= 0) return null;
      if (form === "inv") return probGuard(v) ? normSInv(v) * sv + mv : null;
      const z = (v - mv) / sv;
      return form === "cdf" ? stdNormCDF(z) : exp(-0.5 * z * z) / (sv * sqrt(2 * PI));
    },
  },
  "normal-s": {
    label: "Standard Normal", group: "Continuous", excel: "NORM.S.DIST / NORM.S.INV",
    forms: ["cdf", "pdf", "inv", "sample"], xKey: "z", xLabel: "Z", xDefault: 0,
    params: [],
    compute: (form, v) => {
      if (form === "inv") return probGuard(v) ? normSInv(v) : null;
      return form === "cdf" ? stdNormCDF(v) : exp(-v * v / 2) / sqrt(2 * PI);
    },
  },
  // PHI and GAUSS are standard-normal FORMS (not distributions): PHI reuses the pdf
  // form; GAUSS is Φ − ½, a half-area, and must not be labelled a CDF.
  phi: {
    label: "φ (standard normal density)", group: "Continuous", excel: "PHI",
    forms: ["pdf"], xKey: "x", xLabel: "X", xDefault: 0,
    params: [],
    compute: (_f, v) => exp(-v * v / 2) / sqrt(2 * PI),
  },
  gauss: {
    label: "Gauss (Φ − ½)", group: "Continuous", excel: "GAUSS",
    forms: ["half"], xKey: "x", xLabel: "X", xDefault: 0,
    params: [],
    compute: (_f, v) => stdNormCDF(v) - 0.5,
  },
  t: {
    label: "Student's t", group: "Continuous", excel: "T.DIST / T.DIST.2T / T.DIST.RT / T.INV / T.INV.2T",
    forms: ["cdf", "pdf", "2t", "rt", "inv", "inv2t", "sample"], xKey: "x", xLabel: "X", xDefault: 0,
    params: [{ key: "df", label: "Degrees of freedom", def: 10 }],
    compute: (form, v, [dfv]) => {
      if (dfv <= 0) return null;
      if (form === "inv" || form === "inv2t") {
        if (!probGuard(v)) return null;
        const target = form === "inv" ? v : 1 - v / 2;
        return bisectionInv((t) => tCDF(t, dfv), target, -1e6, 1e6);
      }
      if (form === "cdf") return tCDF(v, dfv);
      if (form === "2t") return 2 * (1 - tCDF(abs(v), dfv));
      if (form === "rt") return 1 - tCDF(v, dfv);
      return tPDF(v, dfv);
    },
  },
  chisq: {
    label: "Chi-squared", group: "Continuous", excel: "CHISQ.DIST / CHISQ.DIST.RT / CHISQ.INV / CHISQ.INV.RT",
    forms: ["cdf", "pdf", "rt", "inv", "invrt", "sample"], xKey: "x", xLabel: "X", xDefault: 1,
    params: [{ key: "df", label: "Degrees of freedom", def: 5 }],
    compute: (form, v, [dfv]) => {
      if (dfv <= 0) return null;
      if (form === "inv" || form === "invrt") {
        if (!probGuard(v)) return null;
        const target = form === "inv" ? v : 1 - v;
        return bisectionInv((x) => chiSqCDF(x, dfv), target, 0, 1e6);
      }
      if (form === "pdf") {
        return v <= 0 ? 0 : exp(-v / 2 + (dfv / 2 - 1) * log(v) - (dfv / 2) * log(2) - lnGamma(dfv / 2));
      }
      const cdfVal = chiSqCDF(v, dfv);
      return form === "cdf" ? cdfVal : 1 - cdfVal;
    },
  },
  f: {
    label: "F-distribution", group: "Continuous", excel: "F.DIST / F.DIST.RT / F.INV / F.INV.RT",
    forms: ["cdf", "pdf", "rt", "inv", "invrt", "sample"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "df1", label: "df1", def: 5 }, { key: "df2", label: "df2", def: 10 }],
    compute: (form, v, [d1, d2]) => {
      if (d1 <= 0 || d2 <= 0) return null;
      if (form === "inv" || form === "invrt") {
        if (!probGuard(v)) return null;
        const target = form === "inv" ? v : 1 - v;
        return bisectionInv((x) => fCDF(x, d1, d2), target, 0, 1e6);
      }
      if (form === "cdf") return fCDF(v, d1, d2);
      if (form === "rt") return 1 - fCDF(v, d1, d2);
      if (v <= 0) return 0;
      return exp(
        (d1 / 2) * log(d1) + (d2 / 2) * log(d2) + (d1 / 2 - 1) * log(v) -
        ((d1 + d2) / 2) * log(d1 * v + d2) +
        lnGamma((d1 + d2) / 2) - lnGamma(d1 / 2) - lnGamma(d2 / 2),
      );
    },
  },
  beta: {
    label: "Beta", group: "Continuous", excel: "BETA.DIST / BETA.INV",
    forms: ["cdf", "pdf", "inv", "sample"], xKey: "x", xLabel: "x", xDefault: 0.5,
    params: [{ key: "alpha", label: "alpha", def: 2 }, { key: "beta", label: "beta", def: 5 }],
    compute: (form, v, [av, bv]) => {
      if (av <= 0 || bv <= 0) return null;
      if (form === "inv") {
        return probGuard(v) ? bisectionInv((x) => regularizedBeta(x, av, bv), v, 0, 1) : null;
      }
      if (v < 0 || v > 1) return null;
      if (form === "cdf") return regularizedBeta(v, av, bv);
      if (v === 0 && av < 1) return null;
      if (v === 1 && bv < 1) return null;
      if (v === 0) return av === 1 ? 1 : 0;
      if (v === 1) return bv === 1 ? 1 : 0;
      return exp(
        (av - 1) * log(v) + (bv - 1) * log(1 - v) -
        lnGamma(av) - lnGamma(bv) + lnGamma(av + bv),
      );
    },
  },
  gamma: {
    label: "Gamma", group: "Continuous", excel: "GAMMA.DIST / GAMMA.INV",
    forms: ["cdf", "pdf", "inv", "sample"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "alpha", label: "alpha", def: 2 }, { key: "beta", label: "beta (scale)", def: 2 }],
    compute: (form, v, [av, bv]) => {
      if (av <= 0 || bv <= 0) return null;
      if (form === "inv") {
        return probGuard(v) ? bisectionInv((x) => gammaCDF(x, av, bv), v, 0, 1e6) : null;
      }
      if (form === "cdf") return gammaCDF(v, av, bv);
      return gammaPDF(v, av, bv);
    },
  },
  lognorm: {
    label: "Lognormal", group: "Continuous", excel: "LOGNORM.DIST / LOGNORM.INV",
    forms: ["cdf", "pdf", "inv", "sample"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "mean", label: "mean (ln)", def: 0 }, { key: "stdev", label: "stdev (ln)", def: 1 }],
    compute: (form, v, [mv, sv]) => {
      if (sv <= 0) return null;
      if (form === "inv") return probGuard(v) ? exp(normSInv(v) * sv + mv) : null;
      if (v <= 0) return null;
      if (form === "cdf") return stdNormCDF((log(v) - mv) / sv);
      return exp(-0.5 * ((log(v) - mv) / sv) ** 2) / (v * sv * sqrt(2 * PI));
    },
  },
  weibull: {
    label: "Weibull", group: "Continuous", excel: "WEIBULL.DIST",
    forms: ["cdf", "pdf", "sample"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "alpha", label: "alpha (shape)", def: 2 }, { key: "beta", label: "beta (scale)", def: 2 }],
    compute: (form, v, [av, bv]) => {
      if (av <= 0 || bv <= 0 || v < 0) return null;
      if (form === "cdf") return 1 - exp(-Math.pow(v / bv, av));
      return (av / bv) * Math.pow(v / bv, av - 1) * exp(-Math.pow(v / bv, av));
    },
  },
  expon: {
    label: "Exponential", group: "Continuous", excel: "EXPON.DIST",
    forms: ["cdf", "pdf", "sample"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "lambda", label: "lambda (rate)", def: 1 }],
    compute: (form, v, [lv]) => {
      if (lv <= 0 || v < 0) return null;
      return form === "cdf" ? 1 - exp(-lv * v) : lv * exp(-lv * v);
    },
  },
  binom: {
    label: "Binomial", group: "Discrete", excel: "BINOM.DIST / BINOM.INV",
    forms: ["pmf", "cdf", "inv", "sample"], xKey: "k", xLabel: "k (successes)", xDefault: 3, probLabel: "alpha",
    params: [{ key: "n", label: "n (trials)", def: 10 }, { key: "p", label: "p (probability)", def: 0.5 }],
    compute: (form, v, [nv, pv]) => {
      if (form === "inv") {
        const n = Math.floor(nv);
        if (n < 0 || pv < 0 || pv > 1 || v < 0 || v > 1) return null;
        let cumP = 0;
        for (let k = 0; k <= n; k++) {
          const pmf = binomPmf(k, n, pv);
          if (pmf === null) return null;
          cumP += pmf;
          if (cumP >= v) return k;
        }
        return n; // nothing crosses alpha
      }
      return form === "pmf" ? binomPmf(v, nv, pv) : binomCdf(v, nv, pv);
    },
  },
  poisson: {
    label: "Poisson", group: "Discrete", excel: "POISSON.DIST",
    forms: ["pmf", "cdf", "sample"], xKey: "k", xLabel: "k", xDefault: 3,
    params: [{ key: "lambda", label: "λ (mean)", def: 2 }],
    compute: (form, v, [lv]) => {
      const ki = Math.floor(v);
      if (ki < 0 || lv < 0) return null;
      if (form === "pmf") {
        if (lv === 0) return ki === 0 ? 1 : 0;
        return exp(-lv + ki * log(lv) - lnGamma(ki + 1));
      }
      if (lv === 0) return 1;
      const r = 1 - regularizedGamma(ki + 1, lv);
      return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : null;
    },
  },
  hypgeom: {
    label: "Hypergeometric", group: "Discrete", excel: "HYPGEOM.DIST",
    forms: ["pmf", "cdf", "sample"], xKey: "k", xLabel: "k (sample successes)", xDefault: 2,
    params: [
      { key: "n", label: "n (sample size)", def: 5 },
      { key: "M", label: "M (pop. successes)", def: 10 },
      { key: "N", label: "N (pop. size)", def: 20 },
    ],
    compute: (form, v, [nv, Mv, Nv]) => {
      const ki = Math.floor(v); const ni = Math.floor(nv);
      const Mi = Math.floor(Mv); const Ni = Math.floor(Nv);
      if (form === "pmf") return hypgeomPmf(ki, ni, Mi, Ni);
      const lo = Math.max(0, ni + Mi - Ni);
      const hi = Math.min(ni, Mi);
      // Invalid parameters have no distribution at all (a genuine blank).
      if (Ni <= 0 || Mi < 0 || ni < 0 || Mi > Ni || ni > Ni) return null;
      if (ki < lo) return 0;
      let sum = 0;
      // Support ends at hi = min(n, M); k beyond it adds no probability, so the cumulative
      // is 1 there — the same convention BINOM/POISSON use above their support, not a blank.
      for (let j = lo; j <= Math.min(ki, hi); j++) {
        const pmf = hypgeomPmf(j, ni, Mi, Ni);
        if (pmf === null) return null;
        sum += pmf;
      }
      return Number.isFinite(sum) ? Math.min(1, Math.max(0, sum)) : null;
    },
  },
  negbinom: {
    label: "Negative Binomial", group: "Discrete", excel: "NEGBINOM.DIST",
    forms: ["pmf", "cdf", "sample"], xKey: "k", xLabel: "k (failures)", xDefault: 3,
    params: [{ key: "r", label: "r (successes)", def: 5 }, { key: "p", label: "p (probability)", def: 0.5 }],
    compute: (form, v, [rv, pv]) => {
      const ki = Math.floor(v); const ri = Math.floor(rv);
      if (ki < 0 || ri < 1 || pv <= 0 || pv > 1) return null;
      if (form === "pmf") return exp(lnCombin(ki + ri - 1, ki) + ri * log(pv) + ki * log(1 - pv));
      const r = regularizedBeta(pv, ri, ki + 1);
      return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : null;
    },
  },
};

/** The form the switch lands on: the same form when the target has it, its
 *  natural sibling when one exists (PDF↔PMF across the continuous/discrete
 *  line, any inverse variant → plain Inverse), else the target's default. */
export function formAfterSwitch(form: DistForm, next: DistKey): DistForm {
  const forms = DIST_SPECS[next].forms;
  if (forms.includes(form)) return form;
  if (form === "pdf" && forms.includes("pmf")) return "pmf";
  if (form === "pmf" && forms.includes("pdf")) return "pdf";
  if (isInverseForm(form) && forms.includes("inv")) return "inv";
  return forms[0];
}

/** The sampler behind the `sample` form: one draw by inverse-CDF from a uniform `u` in
 *  (0, 1). Distributions with a closed inverse use it; a continuous one without (Weibull,
 *  exponential) is inverted by bisection on its CDF; a discrete one (Poisson,
 *  hypergeometric, negative binomial) walks k upward until the CDF clears `u`. `null` for
 *  invalid parameters. */
export function sampleQuantile(key: DistKey, u: number, params: number[]): number | null {
  const spec = DIST_SPECS[key];
  const uu = Math.min(1 - 1e-12, Math.max(1e-12, u));
  if (spec.forms.includes("inv")) return spec.compute("inv", uu, params);
  const cdf = (x: number): number | null => spec.compute("cdf", x, params);
  if (spec.group === "Continuous") {
    if (cdf(1) === null && cdf(0) === null) return null;
    return bisectionInv((x) => cdf(x) ?? 0, uu, 0, 1e6);
  }
  for (let k = 0; k < 1_000_000; k++) {
    const F = cdf(k);
    if (F === null) return null;
    if (F >= uu) return k;
  }
  return null;
}
