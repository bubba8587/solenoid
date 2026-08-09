import { ClassicPreset } from "rete";
import { numListIn, numListOut, readInput, broadcast, isInverseOp, syncInverseInput, type BroadcastResult } from "./shared";
import {
  regularizedGamma,
  regularizedBeta,
  normSInv,
  stdNormCDF,
  lnGamma,
  bisectionInv,
} from "./mathUtils";

// ─── F-distribution ───────────────────────────────────────────────────────────
export type FDistOp = "cdf" | "pdf" | "rt" | "inv" | "invrt";

export const F_DIST_OP_META = {
  cdf:   { label: "CDF",        description: "Left-tail F cumulative distribution. Excel: F.DIST." },
  pdf:   { label: "PDF",        description: "Probability density" },
  rt:    { label: "RT",         description: "Right-tail F probability. Excel: F.DIST.RT." },
  inv:   { label: "Inverse",    description: "The x at left-tail probability p. Excel: F.INV." },
  invrt: { label: "Inverse RT", description: "The x at right-tail probability p. Excel: F.INV.RT." },
} satisfies Record<FDistOp, { label: string; description: string }>;

export class FDistNode extends ClassicPreset.Node {
  label: string;
  op: FDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 1, prob: 0.95, df1: 5, df2: 10 };
  readonly xKey = "x";
  readonly paramKeys = ["df1", "df2"];
  width = 180; height = 230;

  constructor(init?: { label?: string; op?: FDistOp }) {
    super("FDist");
    this.label = init?.label ?? "F-distribution";
    this.op = init?.op ?? "cdf";
    syncInverseInput(this, this.op, this.xKey, "x");
    this.addInput("df1", numListIn("df1"));
    this.addInput("df2", numListIn("df2"));
    this.addOutput("result", numListOut("Result"));
  }

  setOp(next: FDistOp): void {
    this.op = next;
    syncInverseInput(this, next, this.xKey, "x");
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const df1 = readInput(inputs.df1, this.literals.df1);
    const df2 = readInput(inputs.df2, this.literals.df2);
    const op = this.op;
    const first = isInverseOp(op)
      ? readInput(inputs.prob, this.literals.prob)
      : readInput(inputs.x, this.literals.x);
    const result = broadcast((v, d1, d2) => {
      if (d1 <= 0 || d2 <= 0) return null;
      const fCdf = (t: number) =>
        t <= 0 ? 0 : regularizedBeta((t * d1) / (t * d1 + d2), d1 / 2, d2 / 2);
      let r: number;
      if (op === "inv" || op === "invrt") {
        if (v <= 0 || v >= 1) return null;
        const target = op === "inv" ? v : 1 - v;
        r = bisectionInv(fCdf, target, 0, 1e6);
      } else if (op === "cdf") {
        r = fCdf(v);
      } else if (op === "pdf") {
        if (v <= 0) return 0;
        r = Math.exp(
          (d1 / 2) * Math.log(d1) +
            (d2 / 2) * Math.log(d2) +
            (d1 / 2 - 1) * Math.log(v) -
            ((d1 + d2) / 2) * Math.log(d1 * v + d2) +
            lnGamma((d1 + d2) / 2) -
            lnGamma(d1 / 2) -
            lnGamma(d2 / 2),
        );
      } else {
        r = 1 - fCdf(v);
      }
      return Number.isFinite(r) ? r : null;
    }, first, df1, df2);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Beta ─────────────────────────────────────────────────────────────────────
export type BetaDistOp = "cdf" | "pdf" | "inv";

export const BETA_DIST_OP_META = {
  cdf: { label: "CDF",     description: "Beta cumulative distribution I_x(alpha, beta). Excel: BETA.DIST, cumulative=TRUE." },
  pdf: { label: "PDF",     description: "Beta probability density. Excel: BETA.DIST, cumulative=FALSE." },
  inv: { label: "Inverse", description: "The x at cumulative probability p (the quantile). Excel: BETA.INV." },
} satisfies Record<BetaDistOp, { label: string; description: string }>;

export class BetaDistNode extends ClassicPreset.Node {
  label: string;
  op: BetaDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 0.5, prob: 0.95, alpha: 2, beta: 5 };
  readonly xKey = "x";
  readonly paramKeys = ["alpha", "beta"];
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: BetaDistOp }) {
    super("BetaDist");
    this.label = init?.label ?? "Beta";
    this.op = init?.op ?? "cdf";
    syncInverseInput(this, this.op, this.xKey, "x");
    this.addInput("alpha", numListIn("alpha"));
    this.addInput("beta",  numListIn("beta"));
    this.addOutput("result", numListOut("Result"));
  }

  setOp(next: BetaDistOp): void {
    this.op = next;
    syncInverseInput(this, next, this.xKey, "x");
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const alpha = readInput(inputs.alpha, this.literals.alpha);
    const beta  = readInput(inputs.beta,  this.literals.beta);
    const op = this.op;
    const first = op === "inv"
      ? readInput(inputs.prob, this.literals.prob)
      : readInput(inputs.x, this.literals.x);
    const result = broadcast((v, av, bv) => {
      if (av <= 0 || bv <= 0) return null;
      if (op === "inv") {
        if (v <= 0 || v >= 1) return null;
        const r = bisectionInv((x) => regularizedBeta(x, av, bv), v, 0, 1);
        return Number.isFinite(r) ? r : null;
      }
      if (v < 0 || v > 1) return null;
      if (op === "cdf") {
        const r = regularizedBeta(v, av, bv);
        return Number.isFinite(r) ? r : null;
      } else {
        if (v === 0 && av < 1) return null;
        if (v === 1 && bv < 1) return null;
        if (v === 0) return av === 1 ? 1 : 0;
        if (v === 1) return bv === 1 ? 1 : 0;
        const r = Math.exp(
          (av - 1) * Math.log(v) +
            (bv - 1) * Math.log(1 - v) -
            lnGamma(av) -
            lnGamma(bv) +
            lnGamma(av + bv),
        );
        return Number.isFinite(r) ? r : null;
      }
    }, first, alpha, beta);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Gamma ────────────────────────────────────────────────────────────────────
export type GammaDistOp = "cdf" | "pdf" | "inv";

export const GAMMA_DIST_OP_META = {
  cdf: { label: "CDF",     description: "Gamma cumulative distribution. Excel: GAMMA.DIST, cumulative=TRUE." },
  pdf: { label: "PDF",     description: "Gamma probability density. Excel: GAMMA.DIST, cumulative=FALSE." },
  inv: { label: "Inverse", description: "The x at cumulative probability p (the quantile). Excel: GAMMA.INV." },
} satisfies Record<GammaDistOp, { label: string; description: string }>;

export class GammaDistNode extends ClassicPreset.Node {
  label: string;
  op: GammaDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 1, prob: 0.95, alpha: 2, beta: 2 };
  readonly xKey = "x";
  readonly paramKeys = ["alpha", "beta"];
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: GammaDistOp }) {
    super("GammaDist");
    this.label = init?.label ?? "Gamma distribution";
    this.op = init?.op ?? "cdf";
    syncInverseInput(this, this.op, this.xKey, "x");
    this.addInput("alpha", numListIn("alpha"));
    this.addInput("beta",  numListIn("beta (scale)"));
    this.addOutput("result", numListOut("Result"));
  }

  setOp(next: GammaDistOp): void {
    this.op = next;
    syncInverseInput(this, next, this.xKey, "x");
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const alpha = readInput(inputs.alpha, this.literals.alpha);
    const beta  = readInput(inputs.beta,  this.literals.beta);
    const op = this.op;
    const first = op === "inv"
      ? readInput(inputs.prob, this.literals.prob)
      : readInput(inputs.x, this.literals.x);
    const result = broadcast((v, av, bv) => {
      if (av <= 0 || bv <= 0) return null;
      let r: number;
      if (op === "inv") {
        if (v <= 0 || v >= 1) return null;
        r = bisectionInv((x) => (x <= 0 ? 0 : regularizedGamma(av, x / bv)), v, 0, 1e6);
      } else if (op === "cdf") {
        r = v <= 0 ? 0 : regularizedGamma(av, v / bv);
      } else {
        r = v <= 0 ? 0 : Math.exp((av - 1) * Math.log(v) - v / bv - av * Math.log(bv) - lnGamma(av));
      }
      return Number.isFinite(r) ? r : null;
    }, first, alpha, beta);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Lognormal ────────────────────────────────────────────────────────────────
export type LognormDistOp = "cdf" | "pdf" | "inv";

export const LOGNORM_DIST_OP_META = {
  cdf: { label: "CDF",     description: "Lognormal CDF: Φ((ln(x)−μ)/σ). Excel: LOGNORM.DIST." },
  pdf: { label: "PDF",     description: "Lognormal PDF. Excel: LOGNORM.DIST, cumulative=FALSE." },
  inv: { label: "Inverse", description: "The x at cumulative probability p (the quantile). Excel: LOGNORM.INV." },
} satisfies Record<LognormDistOp, { label: string; description: string }>;

export class LognormDistNode extends ClassicPreset.Node {
  label: string;
  op: LognormDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 1, prob: 0.95, mean: 0, stdev: 1 };
  readonly xKey = "x";
  readonly paramKeys = ["mean", "stdev"];
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: LognormDistOp }) {
    super("LognormDist");
    this.label = init?.label ?? "Lognormal";
    this.op = init?.op ?? "cdf";
    syncInverseInput(this, this.op, this.xKey, "x");
    this.addInput("mean",  numListIn("mean (ln)"));
    this.addInput("stdev", numListIn("stdev (ln)"));
    this.addOutput("result", numListOut("Result"));
  }

  setOp(next: LognormDistOp): void {
    this.op = next;
    syncInverseInput(this, next, this.xKey, "x");
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const mean  = readInput(inputs.mean,  this.literals.mean);
    const stdev = readInput(inputs.stdev, this.literals.stdev);
    const op = this.op;
    const first = op === "inv"
      ? readInput(inputs.prob, this.literals.prob)
      : readInput(inputs.x, this.literals.x);
    const result = broadcast((v, mv, sv) => {
      if (sv <= 0) return null;
      let r: number;
      if (op === "inv") {
        if (v <= 0 || v >= 1) return null;
        r = Math.exp(normSInv(v) * sv + mv);
      } else {
        if (v <= 0) return null;
        if (op === "cdf") {
          r = stdNormCDF((Math.log(v) - mv) / sv);
        } else {
          r = Math.exp(-0.5 * ((Math.log(v) - mv) / sv) ** 2) / (v * sv * Math.sqrt(2 * Math.PI));
        }
      }
      return Number.isFinite(r) ? r : null;
    }, first, mean, stdev);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Weibull ──────────────────────────────────────────────────────────────────
export type WeibullDistOp = "cdf" | "pdf";

export const WEIBULL_DIST_OP_META = {
  cdf: { label: "CDF", description: "Weibull CDF: 1 − exp(−(x/β)^α). Excel: WEIBULL.DIST, cumulative=TRUE." },
  pdf: { label: "PDF", description: "Weibull PDF. Excel: WEIBULL.DIST, cumulative=FALSE." },
} satisfies Record<WeibullDistOp, { label: string; description: string }>;

export class WeibullDistNode extends ClassicPreset.Node {
  label: string;
  op: WeibullDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 1, alpha: 2, beta: 2 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: WeibullDistOp }) {
    super("WeibullDist");
    this.label = init?.label ?? "Weibull";
    this.op = init?.op ?? "cdf";
    this.addInput("x",     numListIn("x"));
    this.addInput("alpha", numListIn("alpha (shape)"));
    this.addInput("beta",  numListIn("beta (scale)"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const x     = readInput(inputs.x,     this.literals.x);
    const alpha = readInput(inputs.alpha, this.literals.alpha);
    const beta  = readInput(inputs.beta,  this.literals.beta);
    const op = this.op;
    const result = broadcast((xv, av, bv) => {
      if (av <= 0 || bv <= 0 || xv < 0) return null;
      let r: number;
      if (op === "cdf") {
        r = 1 - Math.exp(-Math.pow(xv / bv, av));
      } else {
        r = (av / bv) * Math.pow(xv / bv, av - 1) * Math.exp(-Math.pow(xv / bv, av));
      }
      return Number.isFinite(r) ? r : null;
    }, x, alpha, beta);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Exponential ──────────────────────────────────────────────────────────────
export type ExponDistOp = "cdf" | "pdf";

export const EXPON_DIST_OP_META = {
  cdf: { label: "CDF", description: "Exponential CDF: 1 − e^(−λx). Excel: EXPON.DIST, cumulative=TRUE." },
  pdf: { label: "PDF", description: "Exponential PDF: λ·e^(−λx). Excel: EXPON.DIST, cumulative=FALSE." },
} satisfies Record<ExponDistOp, { label: string; description: string }>;

export class ExponDistNode extends ClassicPreset.Node {
  label: string;
  op: ExponDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 1, lambda: 1 };
  width = 180; height = 205;

  constructor(init?: { label?: string; op?: ExponDistOp }) {
    super("ExponDist");
    this.label = init?.label ?? "Exponential";
    this.op = init?.op ?? "cdf";
    this.addInput("x",      numListIn("x"));
    this.addInput("lambda", numListIn("lambda (rate)"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const x      = readInput(inputs.x,      this.literals.x);
    const lambda = readInput(inputs.lambda, this.literals.lambda);
    const op = this.op;
    const result = broadcast((xv, lv) => {
      if (lv <= 0 || xv < 0) return null;
      const r = op === "cdf" ? 1 - Math.exp(-lv * xv) : lv * Math.exp(-lv * xv);
      return Number.isFinite(r) ? r : null;
    }, x, lambda);
    this.cachedResult = result;
    return { result };
  }
}
