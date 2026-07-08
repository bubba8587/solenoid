import { ClassicPreset } from "rete";
import { numIn, numOut } from "./shared";
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
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 1, df1: 5, df2: 10 };
  width = 180; height = 230;

  constructor(init?: { label?: string; op?: FDistOp }) {
    super("FDist");
    this.label = init?.label ?? "F.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",   numIn("x"));
    this.addInput("df1", numIn("df1"));
    this.addInput("df2", numIn("df2"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; df1?: number[]; df2?: number[] }) {
    const x   = inputs.x?.[0]   ?? this.literals.x   ?? null;
    const df1 = inputs.df1?.[0] ?? this.literals.df1 ?? null;
    const df2 = inputs.df2?.[0] ?? this.literals.df2 ?? null;
    let result: number | null = null;
    if (x !== null && df1 !== null && df2 !== null && df1 > 0 && df2 > 0) {
      const fCdf = (v: number) =>
        v <= 0 ? 0 : regularizedBeta((v * df1) / (v * df1 + df2), df1 / 2, df2 / 2);
      if (this.op === "cdf") {
        result = fCdf(x);
      } else if (this.op === "pdf") {
        if (x <= 0) {
          result = 0;
        } else {
          result = Math.exp(
            (df1 / 2) * Math.log(df1) +
              (df2 / 2) * Math.log(df2) +
              (df1 / 2 - 1) * Math.log(x) -
              ((df1 + df2) / 2) * Math.log(df1 * x + df2) +
              lnGamma((df1 + df2) / 2) -
              lnGamma(df1 / 2) -
              lnGamma(df2 / 2),
          );
        }
      } else {
        result = 1 - fCdf(x);
      }
      if (result !== null && !Number.isFinite(result)) result = null;
    }
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
  cachedResult: number | null = null;
  literals: Record<string, number> = { prob: 0.95, df1: 5, df2: 10 };
  width = 180; height = 215;

  constructor(init?: { label?: string; op?: FInvOp }) {
    super("FInv");
    this.label = init?.label ?? "F.INV";
    this.op = init?.op ?? "left";
    this.addInput("prob", numIn("Probability"));
    this.addInput("df1",  numIn("df1"));
    this.addInput("df2",  numIn("df2"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { prob?: number[]; df1?: number[]; df2?: number[] }) {
    const prob = inputs.prob?.[0] ?? this.literals.prob ?? null;
    const df1  = inputs.df1?.[0]  ?? this.literals.df1  ?? null;
    const df2  = inputs.df2?.[0]  ?? this.literals.df2  ?? null;
    let result: number | null = null;
    if (prob !== null && df1 !== null && df2 !== null && df1 > 0 && df2 > 0 && prob > 0 && prob < 1) {
      const fCdf = (v: number) =>
        v <= 0 ? 0 : regularizedBeta((v * df1) / (v * df1 + df2), df1 / 2, df2 / 2);
      const target = this.op === "left" ? prob : 1 - prob;
      result = bisectionInv(fCdf, target, 0, 1e6);
      if (!Number.isFinite(result)) result = null;
    }
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
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 0.5, alpha: 2, beta: 5 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: BetaDistOp }) {
    super("BetaDist");
    this.label = init?.label ?? "BETA.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",     numIn("x"));
    this.addInput("alpha", numIn("alpha"));
    this.addInput("beta",  numIn("beta"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; alpha?: number[]; beta?: number[] }) {
    const x     = inputs.x?.[0]     ?? this.literals.x     ?? null;
    const alpha = inputs.alpha?.[0] ?? this.literals.alpha ?? null;
    const beta  = inputs.beta?.[0]  ?? this.literals.beta  ?? null;
    let result: number | null = null;
    if (x !== null && alpha !== null && beta !== null && alpha > 0 && beta > 0) {
      if (x < 0 || x > 1) {
        result = null;
      } else if (this.op === "cdf") {
        result = regularizedBeta(x, alpha, beta);
      } else {
        // PDF: handle boundary edge cases
        if (x === 0 && alpha < 1) result = null;
        else if (x === 1 && beta < 1) result = null;
        else if (x === 0) result = alpha === 1 ? 1 : 0;
        else if (x === 1) result = beta === 1 ? 1 : 0;
        else {
          result = Math.exp(
            (alpha - 1) * Math.log(x) +
              (beta - 1) * Math.log(1 - x) -
              lnGamma(alpha) -
              lnGamma(beta) +
              lnGamma(alpha + beta),
          );
        }
      }
      if (result !== null && !Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── BETA.INV ─────────────────────────────────────────────────────────────────
export class BetaInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { prob: 0.95, alpha: 2, beta: 5 };
  width = 180; height = 205;

  constructor(init?: { label?: string }) {
    super("BetaInv");
    this.label = init?.label ?? "BETA.INV";
    this.addInput("prob",  numIn("Probability"));
    this.addInput("alpha", numIn("alpha"));
    this.addInput("beta",  numIn("beta"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { prob?: number[]; alpha?: number[]; beta?: number[] }) {
    const prob  = inputs.prob?.[0]  ?? this.literals.prob  ?? null;
    const alpha = inputs.alpha?.[0] ?? this.literals.alpha ?? null;
    const beta  = inputs.beta?.[0]  ?? this.literals.beta  ?? null;
    let result: number | null = null;
    if (prob !== null && alpha !== null && beta !== null && alpha > 0 && beta > 0 && prob > 0 && prob < 1) {
      result = bisectionInv((x) => regularizedBeta(x, alpha, beta), prob, 0, 1);
      if (!Number.isFinite(result)) result = null;
    }
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
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 1, alpha: 2, beta: 2 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: GammaDistOp }) {
    super("GammaDist");
    this.label = init?.label ?? "GAMMA.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",     numIn("x"));
    this.addInput("alpha", numIn("alpha"));
    this.addInput("beta",  numIn("beta (scale)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; alpha?: number[]; beta?: number[] }) {
    const x     = inputs.x?.[0]     ?? this.literals.x     ?? null;
    const alpha = inputs.alpha?.[0] ?? this.literals.alpha ?? null;
    const beta  = inputs.beta?.[0]  ?? this.literals.beta  ?? null;
    let result: number | null = null;
    if (x !== null && alpha !== null && beta !== null && alpha > 0 && beta > 0) {
      if (this.op === "cdf") {
        result = x <= 0 ? 0 : regularizedGamma(alpha, x / beta);
      } else {
        result = x <= 0
          ? 0
          : Math.exp(
              (alpha - 1) * Math.log(x) - x / beta - alpha * Math.log(beta) - lnGamma(alpha),
            );
      }
      if (result !== null && !Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── GAMMA.INV ────────────────────────────────────────────────────────────────
export class GammaInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { prob: 0.95, alpha: 2, beta: 2 };
  width = 180; height = 205;

  constructor(init?: { label?: string }) {
    super("GammaInv");
    this.label = init?.label ?? "GAMMA.INV";
    this.addInput("prob",  numIn("Probability"));
    this.addInput("alpha", numIn("alpha"));
    this.addInput("beta",  numIn("beta (scale)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { prob?: number[]; alpha?: number[]; beta?: number[] }) {
    const prob  = inputs.prob?.[0]  ?? this.literals.prob  ?? null;
    const alpha = inputs.alpha?.[0] ?? this.literals.alpha ?? null;
    const beta  = inputs.beta?.[0]  ?? this.literals.beta  ?? null;
    let result: number | null = null;
    if (prob !== null && alpha !== null && beta !== null && alpha > 0 && beta > 0 && prob > 0 && prob < 1) {
      result = bisectionInv((x) => (x <= 0 ? 0 : regularizedGamma(alpha, x / beta)), prob, 0, 1e6);
      if (!Number.isFinite(result)) result = null;
    }
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
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 1, mean: 0, stdev: 1 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: LognormDistOp }) {
    super("LognormDist");
    this.label = init?.label ?? "LOGNORM.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",     numIn("x"));
    this.addInput("mean",  numIn("mean (ln)"));
    this.addInput("stdev", numIn("stdev (ln)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; mean?: number[]; stdev?: number[] }) {
    const x     = inputs.x?.[0]     ?? this.literals.x     ?? null;
    const mean  = inputs.mean?.[0]  ?? this.literals.mean  ?? null;
    const stdev = inputs.stdev?.[0] ?? this.literals.stdev ?? null;
    let result: number | null = null;
    if (x !== null && mean !== null && stdev !== null && stdev > 0) {
      if (x <= 0) {
        result = null;
      } else if (this.op === "cdf") {
        result = stdNormCDF((Math.log(x) - mean) / stdev);
      } else {
        result =
          Math.exp(-0.5 * ((Math.log(x) - mean) / stdev) ** 2) /
          (x * stdev * Math.sqrt(2 * Math.PI));
      }
      if (result !== null && !Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── LOGNORM.INV ─────────────────────────────────────────────────────────────
export class LognormInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { prob: 0.95, mean: 0, stdev: 1 };
  width = 180; height = 205;

  constructor(init?: { label?: string }) {
    super("LognormInv");
    this.label = init?.label ?? "LOGNORM.INV";
    this.addInput("prob",  numIn("Probability"));
    this.addInput("mean",  numIn("mean (ln)"));
    this.addInput("stdev", numIn("stdev (ln)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { prob?: number[]; mean?: number[]; stdev?: number[] }) {
    const prob  = inputs.prob?.[0]  ?? this.literals.prob  ?? null;
    const mean  = inputs.mean?.[0]  ?? this.literals.mean  ?? null;
    const stdev = inputs.stdev?.[0] ?? this.literals.stdev ?? null;
    let result: number | null = null;
    if (prob !== null && mean !== null && stdev !== null && stdev > 0 && prob > 0 && prob < 1) {
      result = Math.exp(normSInv(prob) * stdev + mean);
      if (!Number.isFinite(result)) result = null;
    }
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
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 1, alpha: 2, beta: 2 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: WeibullDistOp }) {
    super("WeibullDist");
    this.label = init?.label ?? "WEIBULL.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",     numIn("x"));
    this.addInput("alpha", numIn("alpha (shape)"));
    this.addInput("beta",  numIn("beta (scale)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; alpha?: number[]; beta?: number[] }) {
    const x     = inputs.x?.[0]     ?? this.literals.x     ?? null;
    const alpha = inputs.alpha?.[0] ?? this.literals.alpha ?? null;
    const beta  = inputs.beta?.[0]  ?? this.literals.beta  ?? null;
    let result: number | null = null;
    if (x !== null && alpha !== null && beta !== null && alpha > 0 && beta > 0) {
      if (x < 0) {
        result = null;
      } else if (this.op === "cdf") {
        result = 1 - Math.exp(-Math.pow(x / beta, alpha));
      } else {
        result =
          (alpha / beta) *
          Math.pow(x / beta, alpha - 1) *
          Math.exp(-Math.pow(x / beta, alpha));
      }
      if (result !== null && !Number.isFinite(result)) result = null;
    }
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
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 1, lambda: 1 };
  width = 180; height = 205;

  constructor(init?: { label?: string; op?: ExponDistOp }) {
    super("ExponDist");
    this.label = init?.label ?? "EXPON.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",      numIn("x"));
    this.addInput("lambda", numIn("lambda (rate)"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; lambda?: number[] }) {
    const x      = inputs.x?.[0]      ?? this.literals.x      ?? null;
    const lambda = inputs.lambda?.[0] ?? this.literals.lambda ?? null;
    let result: number | null = null;
    if (x !== null && lambda !== null && lambda > 0) {
      if (x < 0) {
        result = null;
      } else if (this.op === "cdf") {
        result = 1 - Math.exp(-lambda * x);
      } else {
        result = lambda * Math.exp(-lambda * x);
      }
      if (result !== null && !Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}
