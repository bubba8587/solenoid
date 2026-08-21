import { ClassicPreset } from "rete";
import { numListIn, numListOut, readInput, broadcast, type BroadcastResult } from "./shared";
import {
  stdNormCDF,
  normSInv,
  regularizedGamma,
  regularizedBeta,
  lnGamma,
  lnCombin,
  bisectionInv,
} from "./mathUtils";

const { PI, exp, log, sqrt, abs } = Math;

// ─── The one Distribution node ────────────────────────────────────────────────
// Every probability distribution behind ONE card (D34): the `op` selector picks
// the distribution, the `form` selector picks the curve (CDF / PDF / PMF / the
// tails) or the inverse (quantile). An inverse form trades the x-style first
// input for a probability; the parameter inputs are the distribution's own.

export type DistForm = "cdf" | "pdf" | "pmf" | "2t" | "rt" | "inv" | "inv2t" | "invrt";

/** An inverse (quantile) form reads a probability; every other form reads an x. */
export const isInverseForm = (form: string): boolean => form.startsWith("inv");

export const DIST_FORM_META = {
  cdf:   { label: "CDF",        description: "Cumulative probability P(X ≤ x)" },
  pdf:   { label: "PDF",        description: "Probability density" },
  pmf:   { label: "PMF",        description: "Probability of exactly k" },
  "2t":  { label: "2T",         description: "Two-tailed probability" },
  rt:    { label: "RT",         description: "Right-tail probability" },
  inv:   { label: "Inverse",    description: "The value at cumulative probability p (the quantile)" },
  inv2t: { label: "Inverse 2T", description: "The positive value with two-tailed probability p" },
  invrt: { label: "Inverse RT", description: "The value at right-tail probability p" },
} satisfies Record<DistForm, { label: string; description: string }>;

export type DistKey =
  | "normal" | "normal-s" | "t" | "chisq" | "f" | "beta" | "gamma" | "lognorm"
  | "weibull" | "expon" | "binom" | "poisson" | "hypgeom" | "negbinom";

interface DistSpec {
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

function tDistCDF(x: number, df: number): number {
  const t2 = x * x;
  const z = df / (df + t2);
  const betaCDF = regularizedBeta(z, df / 2, 0.5);
  return x >= 0 ? 1 - betaCDF / 2 : betaCDF / 2;
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
    forms: ["cdf", "pdf", "inv"], xKey: "x", xLabel: "X", xDefault: 0,
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
    forms: ["cdf", "pdf", "inv"], xKey: "z", xLabel: "Z", xDefault: 0,
    params: [],
    compute: (form, v) => {
      if (form === "inv") return probGuard(v) ? normSInv(v) : null;
      return form === "cdf" ? stdNormCDF(v) : exp(-v * v / 2) / sqrt(2 * PI);
    },
  },
  t: {
    label: "Student's t", group: "Continuous", excel: "T.DIST / T.DIST.2T / T.DIST.RT / T.INV / T.INV.2T",
    forms: ["cdf", "pdf", "2t", "rt", "inv", "inv2t"], xKey: "x", xLabel: "X", xDefault: 0,
    params: [{ key: "df", label: "Degrees of freedom", def: 10 }],
    compute: (form, v, [dfv]) => {
      if (dfv <= 0) return null;
      if (form === "inv" || form === "inv2t") {
        if (!probGuard(v)) return null;
        const target = form === "inv" ? v : 1 - v / 2;
        return bisectionInv((t) => tDistCDF(t, dfv), target, -1e6, 1e6);
      }
      if (form === "cdf") return tDistCDF(v, dfv);
      if (form === "2t") return 2 * (1 - tDistCDF(abs(v), dfv));
      if (form === "rt") return 1 - tDistCDF(v, dfv);
      return exp(lnGamma((dfv + 1) / 2) - lnGamma(dfv / 2)) /
        (sqrt(dfv * PI) * Math.pow(1 + v * v / dfv, (dfv + 1) / 2));
    },
  },
  chisq: {
    label: "Chi-squared", group: "Continuous", excel: "CHISQ.DIST / CHISQ.DIST.RT / CHISQ.INV / CHISQ.INV.RT",
    forms: ["cdf", "pdf", "rt", "inv", "invrt"], xKey: "x", xLabel: "X", xDefault: 1,
    params: [{ key: "df", label: "Degrees of freedom", def: 5 }],
    compute: (form, v, [dfv]) => {
      if (dfv <= 0) return null;
      if (form === "inv" || form === "invrt") {
        if (!probGuard(v)) return null;
        const target = form === "inv" ? v : 1 - v;
        return bisectionInv((x) => regularizedGamma(dfv / 2, x / 2), target, 0, 1e6);
      }
      if (form === "pdf") {
        return v <= 0 ? 0 : exp(-v / 2 + (dfv / 2 - 1) * log(v) - (dfv / 2) * log(2) - lnGamma(dfv / 2));
      }
      const cdfVal = v <= 0 ? 0 : regularizedGamma(dfv / 2, v / 2);
      return form === "cdf" ? cdfVal : 1 - cdfVal;
    },
  },
  f: {
    label: "F-distribution", group: "Continuous", excel: "F.DIST / F.DIST.RT / F.INV / F.INV.RT",
    forms: ["cdf", "pdf", "rt", "inv", "invrt"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "df1", label: "df1", def: 5 }, { key: "df2", label: "df2", def: 10 }],
    compute: (form, v, [d1, d2]) => {
      if (d1 <= 0 || d2 <= 0) return null;
      const fCdf = (t: number) =>
        t <= 0 ? 0 : regularizedBeta((t * d1) / (t * d1 + d2), d1 / 2, d2 / 2);
      if (form === "inv" || form === "invrt") {
        if (!probGuard(v)) return null;
        const target = form === "inv" ? v : 1 - v;
        return bisectionInv(fCdf, target, 0, 1e6);
      }
      if (form === "cdf") return fCdf(v);
      if (form === "rt") return 1 - fCdf(v);
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
    forms: ["cdf", "pdf", "inv"], xKey: "x", xLabel: "x", xDefault: 0.5,
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
    forms: ["cdf", "pdf", "inv"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "alpha", label: "alpha", def: 2 }, { key: "beta", label: "beta (scale)", def: 2 }],
    compute: (form, v, [av, bv]) => {
      if (av <= 0 || bv <= 0) return null;
      if (form === "inv") {
        return probGuard(v)
          ? bisectionInv((x) => (x <= 0 ? 0 : regularizedGamma(av, x / bv)), v, 0, 1e6)
          : null;
      }
      if (form === "cdf") return v <= 0 ? 0 : regularizedGamma(av, v / bv);
      return v <= 0 ? 0 : exp((av - 1) * log(v) - v / bv - av * log(bv) - lnGamma(av));
    },
  },
  lognorm: {
    label: "Lognormal", group: "Continuous", excel: "LOGNORM.DIST / LOGNORM.INV",
    forms: ["cdf", "pdf", "inv"], xKey: "x", xLabel: "x", xDefault: 1,
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
    forms: ["cdf", "pdf"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "alpha", label: "alpha (shape)", def: 2 }, { key: "beta", label: "beta (scale)", def: 2 }],
    compute: (form, v, [av, bv]) => {
      if (av <= 0 || bv <= 0 || v < 0) return null;
      if (form === "cdf") return 1 - exp(-Math.pow(v / bv, av));
      return (av / bv) * Math.pow(v / bv, av - 1) * exp(-Math.pow(v / bv, av));
    },
  },
  expon: {
    label: "Exponential", group: "Continuous", excel: "EXPON.DIST",
    forms: ["cdf", "pdf"], xKey: "x", xLabel: "x", xDefault: 1,
    params: [{ key: "lambda", label: "lambda (rate)", def: 1 }],
    compute: (form, v, [lv]) => {
      if (lv <= 0 || v < 0) return null;
      return form === "cdf" ? 1 - exp(-lv * v) : lv * exp(-lv * v);
    },
  },
  binom: {
    label: "Binomial", group: "Discrete", excel: "BINOM.DIST / BINOM.INV",
    forms: ["pmf", "cdf", "inv"], xKey: "k", xLabel: "k (successes)", xDefault: 3, probLabel: "alpha",
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
    forms: ["pmf", "cdf"], xKey: "k", xLabel: "k", xDefault: 3,
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
    forms: ["pmf", "cdf"], xKey: "k", xLabel: "k (sample successes)", xDefault: 2,
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
    forms: ["pmf", "cdf"], xKey: "k", xLabel: "k (failures)", xDefault: 3,
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

function inputKeysFor(op: DistKey, form: DistForm): string[] {
  const spec = DIST_SPECS[op];
  return [isInverseForm(form) ? "prob" : spec.xKey, ...spec.params.map((p) => p.key)];
}

export class DistributionNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    k: "The count rounds down to a whole number.",
    result: "A value or parameter outside the distribution's domain gives a blank, not an error.",
  };

  label: string;
  op: DistKey;
  form: DistForm;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = {};
  width = 190;
  height = 200;

  constructor(init?: { label?: string; op?: DistKey; form?: DistForm }) {
    super("Distribution");
    this.label = init?.label ?? "Distribution";
    this.op = init?.op ?? "normal";
    const spec = DIST_SPECS[this.op];
    this.form = init?.form && spec.forms.includes(init.form) ? init.form : spec.forms[0];
    for (const key of inputKeysFor(this.op, this.form)) this.addInput(key, this.makeInput(key));
    this.addOutput("result", numListOut("Result"));
    this.seedLiterals();
    this.height = 203 + 28 * spec.params.length;
  }

  get spec(): DistSpec { return DIST_SPECS[this.op]; }
  get xKey(): string { return this.spec.xKey; }
  get paramKeys(): string[] { return this.spec.params.map((p) => p.key); }

  private makeInput(key: string) {
    const spec = this.spec;
    if (key === "prob") return numListIn(spec.probLabel ?? "Probability");
    if (key === spec.xKey) return numListIn(spec.xLabel);
    const param = spec.params.find((p) => p.key === key)!;
    return numListIn(param.label);
  }

  private seedLiterals(): void {
    const spec = this.spec;
    this.literals[spec.xKey] ??= spec.xDefault;
    this.literals.prob ??= 0.95;
    for (const p of spec.params) this.literals[p.key] ??= p.def;
  }

  /** The keys a switch to `next` would remove. Callers on a live graph prune
   *  these BEFORE calling setOp (SSOT-9). */
  keysDroppedBySwitch(next: DistKey): string[] {
    const keep = new Set(inputKeysFor(next, formAfterSwitch(this.form, next)));
    return inputKeysFor(this.op, this.form).filter((k) => !keep.has(k));
  }

  setOp(next: DistKey): void {
    if (next === this.op) return;
    const before = inputKeysFor(this.op, this.form);
    this.form = formAfterSwitch(this.form, next);
    this.op = next;
    const after = inputKeysFor(next, this.form);
    for (const k of before) if (!after.includes(k)) this.removeInput(k);
    for (const k of after) if (!this.inputs[k]) this.addInput(k, this.makeInput(k));
    this.seedLiterals();
    this.height = 203 + 28 * this.spec.params.length;
  }

  /** Crossing the forward/inverse line swaps the first input; callers prune the
   *  departing key's cables first. */
  setForm(next: DistForm): void {
    if (next === this.form || !this.spec.forms.includes(next)) return;
    const wasInv = isInverseForm(this.form);
    this.form = next;
    const nowInv = isInverseForm(next);
    if (wasInv === nowInv) return;
    if (nowInv) {
      if (this.inputs[this.xKey]) this.removeInput(this.xKey);
      if (!this.inputs.prob) this.addInput("prob", this.makeInput("prob"));
    } else {
      if (this.inputs.prob) this.removeInput("prob");
      if (!this.inputs[this.xKey]) this.addInput(this.xKey, this.makeInput(this.xKey));
    }
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const spec = this.spec;
    const form = this.form;
    const firstKey = isInverseForm(form) ? "prob" : spec.xKey;
    const first = readInput(inputs[firstKey], this.literals[firstKey]);
    const params = spec.params.map((p) => readInput(inputs[p.key], this.literals[p.key]));
    const result = broadcast((v, ...ps) => {
      const r = spec.compute(form, v, ps);
      return r !== null && Number.isFinite(r) ? r : null;
    }, first, ...params);
    this.cachedResult = result;
    return { result };
  }
}
