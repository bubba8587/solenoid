// [[C17]] shareImpl, [[B11]] maximalMerge
export type DistForm = "cdf" | "pdf" | "pmf" | "2t" | "rt" | "inv" | "inv2t" | "invrt" | "sample" | "half";

export const isInverseForm = (form: string): boolean => form.startsWith("inv");

export const DIST_FORM_META = {
  cdf:   { label: "CDF",        description: "Cumulative probability that `X ≤ x`" },
  pdf:   { label: "PDF",        description: "Probability density" },
  pmf:   { label: "PMF",        description: "Probability of exactly `k`" },
  "2t":  { label: "2T",         description: "Two-tailed probability" },
  rt:    { label: "RT",         description: "Right-tail probability" },
  inv:   { label: "Inverse",    description: "The value at cumulative probability `p`, the quantile" },
  inv2t: { label: "Inverse 2T", description: "The positive value with two-tailed probability `p`" },
  invrt: { label: "Inverse RT", description: "The value at right-tail probability `p`" },
  sample: { label: "Sample",    description: "`N` random draws from the distribution, re-rolled on each recalculation. `numpy.random`, R `rnorm` / `rgamma`" },
  half:   { label: "Φ − ½",     description: "Area under the standard normal curve from `0` to `x`" },
} satisfies Record<DistForm, { label: string; description: string }>;

export type DistKey =
  | "normal" | "normal-s" | "phi" | "gauss" | "t" | "chisq" | "f" | "beta" | "gamma" | "lognorm"
  | "weibull" | "expon" | "binom" | "poisson" | "hypgeom" | "negbinom";

export interface DistSpec {
  label: string;
  group: "Continuous" | "Discrete";
  excel: string;
  forms: readonly DistForm[];  // first entry is the default
  xKey: string;
  xLabel: string;
  xDefault: number;
  probLabel?: string;          // inverse-mode first-input label; default "Probability"
  params: ReadonlyArray<{ key: string; label: string; def: number }>;
}

export const DIST_SPECS: Record<DistKey, DistSpec> = {
  normal: {
    label: "Normal", group: "Continuous", excel: "NORM.DIST / NORM.INV",
    forms: ["cdf", "pdf", "inv", "sample"], xKey: "x", xLabel: "X", xDefault: 0,
    params: [{ key: "mean", label: "Mean", def: 0 }, { key: "stdev", label: "Stdev", def: 1 }],
  },
  "normal-s": {
    label: "Standard Normal", group: "Continuous", excel: "NORM.S.DIST / NORM.S.INV",
    forms: ["cdf", "pdf", "inv", "sample"], xKey: "z", xLabel: "Z", xDefault: 0,
    params: [],
  },
  // GAUSS is Φ − ½, a half-area, so its form is `half` and must never be labelled a CDF.
  phi: {
    label: "φ (standard normal density)", group: "Continuous", excel: "PHI",
    forms: ["pdf"], xKey: "x", xLabel: "X", xDefault: 0,
    params: [],
  },
  gauss: {
    label: "Gauss (Φ − ½)", group: "Continuous", excel: "GAUSS",
    forms: ["half"], xKey: "x", xLabel: "X", xDefault: 0,
    params: [],
  },
  t: {
    label: "Student's t", group: "Continuous", excel: "T.DIST / T.DIST.2T / T.DIST.RT / T.INV / T.INV.2T",
    forms: ["cdf", "pdf", "2t", "rt", "inv", "inv2t", "sample"], xKey: "x", xLabel: "X", xDefault: 0,
    params: [{ key: "df", label: "Degrees of freedom", def: 10 }],
  },
  chisq: {
    label: "Chi-squared", group: "Continuous", excel: "CHISQ.DIST / CHISQ.DIST.RT / CHISQ.INV / CHISQ.INV.RT",
    forms: ["cdf", "pdf", "rt", "inv", "invrt", "sample"], xKey: "x", xLabel: "X", xDefault: 1,
    params: [{ key: "df", label: "Degrees of freedom", def: 5 }],
  },
  f: {
    label: "F-distribution", group: "Continuous", excel: "F.DIST / F.DIST.RT / F.INV / F.INV.RT",
    forms: ["cdf", "pdf", "rt", "inv", "invrt", "sample"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "df1", label: "df1", def: 5 }, { key: "df2", label: "df2", def: 10 }],
  },
  beta: {
    label: "Beta", group: "Continuous", excel: "BETA.DIST / BETA.INV",
    forms: ["cdf", "pdf", "inv", "sample"], xKey: "x", xLabel: "x", xDefault: 0.5,
    params: [{ key: "alpha", label: "alpha", def: 2 }, { key: "beta", label: "beta", def: 5 }],
  },
  gamma: {
    label: "Gamma", group: "Continuous", excel: "GAMMA.DIST / GAMMA.INV",
    forms: ["cdf", "pdf", "inv", "sample"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "alpha", label: "alpha", def: 2 }, { key: "beta", label: "beta (scale)", def: 2 }],
  },
  lognorm: {
    label: "Lognormal", group: "Continuous", excel: "LOGNORM.DIST / LOGNORM.INV",
    forms: ["cdf", "pdf", "inv", "sample"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "mean", label: "mean (ln)", def: 0 }, { key: "stdev", label: "stdev (ln)", def: 1 }],
  },
  weibull: {
    label: "Weibull", group: "Continuous", excel: "WEIBULL.DIST",
    forms: ["cdf", "pdf", "sample"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "alpha", label: "alpha (shape)", def: 2 }, { key: "beta", label: "beta (scale)", def: 2 }],
  },
  expon: {
    label: "Exponential", group: "Continuous", excel: "EXPON.DIST",
    forms: ["cdf", "pdf", "sample"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "lambda", label: "lambda (rate)", def: 1 }],
  },
  binom: {
    label: "Binomial", group: "Discrete", excel: "BINOM.DIST / BINOM.INV",
    forms: ["pmf", "cdf", "inv", "sample"], xKey: "k", xLabel: "k (successes)", xDefault: 3, probLabel: "alpha",
    params: [{ key: "n", label: "n (trials)", def: 10 }, { key: "p", label: "p (probability)", def: 0.5 }],
  },
  poisson: {
    label: "Poisson", group: "Discrete", excel: "POISSON.DIST",
    forms: ["pmf", "cdf", "sample"], xKey: "k", xLabel: "k", xDefault: 3,
    params: [{ key: "lambda", label: "λ (mean)", def: 2 }],
  },
  hypgeom: {
    label: "Hypergeometric", group: "Discrete", excel: "HYPGEOM.DIST",
    forms: ["pmf", "cdf", "sample"], xKey: "k", xLabel: "k (sample successes)", xDefault: 2,
    params: [
      { key: "n", label: "n (sample size)", def: 5 },
      { key: "M", label: "M (pop. successes)", def: 10 },
      { key: "N", label: "N (pop. size)", def: 20 },
    ],
  },
  negbinom: {
    label: "Negative Binomial", group: "Discrete", excel: "NEGBINOM.DIST",
    forms: ["pmf", "cdf", "sample"], xKey: "k", xLabel: "k (failures)", xDefault: 3,
    params: [{ key: "r", label: "r (successes)", def: 5 }, { key: "p", label: "p (probability)", def: 0.5 }],
  },
};

export function formAfterSwitch(form: DistForm, next: DistKey): DistForm {
  const forms = DIST_SPECS[next].forms;
  if (forms.includes(form)) return form;
  if (form === "pdf" && forms.includes("pmf")) return "pmf";
  if (form === "pmf" && forms.includes("pdf")) return "pdf";
  if (isInverseForm(form) && forms.includes("inv")) return "inv";
  return forms[0];
}
