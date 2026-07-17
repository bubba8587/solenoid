import { ClassicPreset } from "rete";
import { numListIn, numListOut, readInput, broadcast, type BroadcastResult } from "./shared";
import {
  regularizedGamma,
  regularizedBeta,
  normSInv,
  stdNormCDF,
  lnGamma,
  bisectionInv,
} from "./mathUtils";

// ─── F.DIST ───────────────────────────────────────────────────────────────────
export type FDistOp = "cdf" | "pdf" | "rt";

export const F_DIST_OP_META = {
  cdf: { label: "CDF",        description: "Left-tail F cumulative distribution. Excel: F.DIST." },
  pdf: { label: "PDF",        description: "Probability density" },
  rt:  { label: "Right-tail", description: "Right-tail F probability. Excel: F.DIST.RT." },
} satisfies Record<FDistOp, { label: string; description: string }>;

export class FDistNode extends ClassicPreset.Node {
  label: string;
  op: FDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 1, df1: 5, df2: 10 };
  width = 180; height = 230;

  constructor(init?: { label?: string; op?: FDistOp }) {
    super("FDist");
    this.label = init?.label ?? "F.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",   numListIn("x"));
    this.addInput("df1", numListIn("df1"));
    this.addInput("df2", numListIn("df2"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const x   = readInput(inputs.x,   this.literals.x);
    const df1 = readInput(inputs.df1, this.literals.df1);
    const df2 = readInput(inputs.df2, this.literals.df2);
    const op = this.op;
    const result = broadcast((xv, d1, d2) => {
      if (d1 <= 0 || d2 <= 0) return null;
      const fCdf = (v: number) =>
        v <= 0 ? 0 : regularizedBeta((v * d1) / (v * d1 + d2), d1 / 2, d2 / 2);
      let r: number;
      if (op === "cdf") {
        r = fCdf(xv);
      } else if (op === "pdf") {
        if (xv <= 0) return 0;
        r = Math.exp(
          (d1 / 2) * Math.log(d1) +
            (d2 / 2) * Math.log(d2) +
            (d1 / 2 - 1) * Math.log(xv) -
            ((d1 + d2) / 2) * Math.log(d1 * xv + d2) +
            lnGamma((d1 + d2) / 2) -
            lnGamma(d1 / 2) -
            lnGamma(d2 / 2),
        );
      } else {
        r = 1 - fCdf(xv);
      }
      return Number.isFinite(r) ? r : null;
    }, x, df1, df2);
    this.cachedResult = result;
    return { result };
  }
}

// ─── F.INV ────────────────────────────────────────────────────────────────────
export type FInvOp = "left" | "rt";

export const F_INV_OP_META = {
  left: { label: "Left",       description: "Inverse of left-tail F distribution. Excel: F.INV." },
  rt:   { label: "Right-tail", description: "Inverse of right-tail F distribution. Excel: F.INV.RT." },
} satisfies Record<FInvOp, { label: string; description: string }>;

export class FInvNode extends ClassicPreset.Node {
  label: string;
  op: FInvOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { prob: 0.95, df1: 5, df2: 10 };
  width = 180; height = 215;

  constructor(init?: { label?: string; op?: FInvOp }) {
    super("FInv");
    this.label = init?.label ?? "F.INV";
    this.op = init?.op ?? "left";
    this.addInput("prob", numListIn("Probability"));
    this.addInput("df1",  numListIn("df1"));
    this.addInput("df2",  numListIn("df2"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const prob = readInput(inputs.prob, this.literals.prob);
    const df1  = readInput(inputs.df1,  this.literals.df1);
    const df2  = readInput(inputs.df2,  this.literals.df2);
    const op = this.op;
    const result = broadcast((pv, d1, d2) => {
      if (d1 <= 0 || d2 <= 0 || pv <= 0 || pv >= 1) return null;
      const fCdf = (v: number) =>
        v <= 0 ? 0 : regularizedBeta((v * d1) / (v * d1 + d2), d1 / 2, d2 / 2);
      const target = op === "left" ? pv : 1 - pv;
      const r = bisectionInv(fCdf, target, 0, 1e6);
      return Number.isFinite(r) ? r : null;
    }, prob, df1, df2);
    this.cachedResult = result;
    return { result };
  }
}

// ─── BETA.DIST ────────────────────────────────────────────────────────────────
export type BetaDistOp = "cdf" | "pdf";

export const BETA_DIST_OP_META = {
  cdf: { label: "CDF", description: "Beta cumulative distribution I_x(alpha, beta). Excel: BETA.DIST, cumulative=TRUE." },
  pdf: { label: "PDF", description: "Beta probability density. Excel: BETA.DIST, cumulative=FALSE." },
} satisfies Record<BetaDistOp, { label: string; description: string }>;

export class BetaDistNode extends ClassicPreset.Node {
  label: string;
  op: BetaDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 0.5, alpha: 2, beta: 5 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: BetaDistOp }) {
    super("BetaDist");
    this.label = init?.label ?? "BETA.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",     numListIn("x"));
    this.addInput("alpha", numListIn("alpha"));
    this.addInput("beta",  numListIn("beta"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const x     = readInput(inputs.x,     this.literals.x);
    const alpha = readInput(inputs.alpha, this.literals.alpha);
    const beta  = readInput(inputs.beta,  this.literals.beta);
    const op = this.op;
    const result = broadcast((xv, av, bv) => {
      if (av <= 0 || bv <= 0) return null;
      if (xv < 0 || xv > 1) return null;
      if (op === "cdf") {
        const r = regularizedBeta(xv, av, bv);
        return Number.isFinite(r) ? r : null;
      } else {
        if (xv === 0 && av < 1) return null;
        if (xv === 1 && bv < 1) return null;
        if (xv === 0) return av === 1 ? 1 : 0;
        if (xv === 1) return bv === 1 ? 1 : 0;
        const r = Math.exp(
          (av - 1) * Math.log(xv) +
            (bv - 1) * Math.log(1 - xv) -
            lnGamma(av) -
            lnGamma(bv) +
            lnGamma(av + bv),
        );
        return Number.isFinite(r) ? r : null;
      }
    }, x, alpha, beta);
    this.cachedResult = result;
    return { result };
  }
}

// ─── BETA.INV ─────────────────────────────────────────────────────────────────
export class BetaInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { prob: 0.95, alpha: 2, beta: 5 };
  width = 180; height = 205;

  constructor(init?: { label?: string }) {
    super("BetaInv");
    this.label = init?.label ?? "BETA.INV";
    this.addInput("prob",  numListIn("Probability"));
    this.addInput("alpha", numListIn("alpha"));
    this.addInput("beta",  numListIn("beta"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const prob  = readInput(inputs.prob,  this.literals.prob);
    const alpha = readInput(inputs.alpha, this.literals.alpha);
    const beta  = readInput(inputs.beta,  this.literals.beta);
    const result = broadcast((pv, av, bv) => {
      if (av <= 0 || bv <= 0 || pv <= 0 || pv >= 1) return null;
      const r = bisectionInv((x) => regularizedBeta(x, av, bv), pv, 0, 1);
      return Number.isFinite(r) ? r : null;
    }, prob, alpha, beta);
    this.cachedResult = result;
    return { result };
  }
}

// ─── GAMMA.DIST ───────────────────────────────────────────────────────────────
export type GammaDistOp = "cdf" | "pdf";

export const GAMMA_DIST_OP_META = {
  cdf: { label: "CDF", description: "Gamma cumulative distribution. Excel: GAMMA.DIST, cumulative=TRUE." },
  pdf: { label: "PDF", description: "Gamma probability density. Excel: GAMMA.DIST, cumulative=FALSE." },
} satisfies Record<GammaDistOp, { label: string; description: string }>;

export class GammaDistNode extends ClassicPreset.Node {
  label: string;
  op: GammaDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 1, alpha: 2, beta: 2 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: GammaDistOp }) {
    super("GammaDist");
    this.label = init?.label ?? "GAMMA.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",     numListIn("x"));
    this.addInput("alpha", numListIn("alpha"));
    this.addInput("beta",  numListIn("beta (scale)"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const x     = readInput(inputs.x,     this.literals.x);
    const alpha = readInput(inputs.alpha, this.literals.alpha);
    const beta  = readInput(inputs.beta,  this.literals.beta);
    const op = this.op;
    const result = broadcast((xv, av, bv) => {
      if (av <= 0 || bv <= 0) return null;
      let r: number;
      if (op === "cdf") {
        r = xv <= 0 ? 0 : regularizedGamma(av, xv / bv);
      } else {
        r = xv <= 0 ? 0 : Math.exp((av - 1) * Math.log(xv) - xv / bv - av * Math.log(bv) - lnGamma(av));
      }
      return Number.isFinite(r) ? r : null;
    }, x, alpha, beta);
    this.cachedResult = result;
    return { result };
  }
}

// ─── GAMMA.INV ────────────────────────────────────────────────────────────────
export class GammaInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { prob: 0.95, alpha: 2, beta: 2 };
  width = 180; height = 205;

  constructor(init?: { label?: string }) {
    super("GammaInv");
    this.label = init?.label ?? "GAMMA.INV";
    this.addInput("prob",  numListIn("Probability"));
    this.addInput("alpha", numListIn("alpha"));
    this.addInput("beta",  numListIn("beta (scale)"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const prob  = readInput(inputs.prob,  this.literals.prob);
    const alpha = readInput(inputs.alpha, this.literals.alpha);
    const beta  = readInput(inputs.beta,  this.literals.beta);
    const result = broadcast((pv, av, bv) => {
      if (av <= 0 || bv <= 0 || pv <= 0 || pv >= 1) return null;
      const r = bisectionInv((x) => (x <= 0 ? 0 : regularizedGamma(av, x / bv)), pv, 0, 1e6);
      return Number.isFinite(r) ? r : null;
    }, prob, alpha, beta);
    this.cachedResult = result;
    return { result };
  }
}

// ─── LOGNORM.DIST ─────────────────────────────────────────────────────────────
export type LognormDistOp = "cdf" | "pdf";

export const LOGNORM_DIST_OP_META = {
  cdf: { label: "CDF", description: "Lognormal CDF: Φ((ln(x)−μ)/σ). Excel: LOGNORM.DIST." },
  pdf: { label: "PDF", description: "Lognormal PDF. Excel: LOGNORM.DIST, cumulative=FALSE." },
} satisfies Record<LognormDistOp, { label: string; description: string }>;

export class LognormDistNode extends ClassicPreset.Node {
  label: string;
  op: LognormDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 1, mean: 0, stdev: 1 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: LognormDistOp }) {
    super("LognormDist");
    this.label = init?.label ?? "LOGNORM.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",     numListIn("x"));
    this.addInput("mean",  numListIn("mean (ln)"));
    this.addInput("stdev", numListIn("stdev (ln)"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const x     = readInput(inputs.x,     this.literals.x);
    const mean  = readInput(inputs.mean,  this.literals.mean);
    const stdev = readInput(inputs.stdev, this.literals.stdev);
    const op = this.op;
    const result = broadcast((xv, mv, sv) => {
      if (sv <= 0 || xv <= 0) return null;
      let r: number;
      if (op === "cdf") {
        r = stdNormCDF((Math.log(xv) - mv) / sv);
      } else {
        r = Math.exp(-0.5 * ((Math.log(xv) - mv) / sv) ** 2) / (xv * sv * Math.sqrt(2 * Math.PI));
      }
      return Number.isFinite(r) ? r : null;
    }, x, mean, stdev);
    this.cachedResult = result;
    return { result };
  }
}

// ─── LOGNORM.INV ─────────────────────────────────────────────────────────────
export class LognormInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { prob: 0.95, mean: 0, stdev: 1 };
  width = 180; height = 205;

  constructor(init?: { label?: string }) {
    super("LognormInv");
    this.label = init?.label ?? "LOGNORM.INV";
    this.addInput("prob",  numListIn("Probability"));
    this.addInput("mean",  numListIn("mean (ln)"));
    this.addInput("stdev", numListIn("stdev (ln)"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const prob  = readInput(inputs.prob,  this.literals.prob);
    const mean  = readInput(inputs.mean,  this.literals.mean);
    const stdev = readInput(inputs.stdev, this.literals.stdev);
    const result = broadcast((pv, mv, sv) => {
      if (sv <= 0 || pv <= 0 || pv >= 1) return null;
      const r = Math.exp(normSInv(pv) * sv + mv);
      return Number.isFinite(r) ? r : null;
    }, prob, mean, stdev);
    this.cachedResult = result;
    return { result };
  }
}

// ─── WEIBULL.DIST ─────────────────────────────────────────────────────────────
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
    this.label = init?.label ?? "WEIBULL.DIST";
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

// ─── EXPON.DIST ───────────────────────────────────────────────────────────────
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
    this.label = init?.label ?? "EXPON.DIST";
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
