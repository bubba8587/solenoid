import { ClassicPreset } from "rete";
import { numIn, numOut } from "./shared";
import {
  stdNormCDF,
  normSInv,
  regularizedGamma,
  regularizedBeta,
  lnGamma,
  bisectionInv,
} from "./mathUtils";

const { PI, exp, log, sqrt, abs } = Math;

// ─── Helper: t-distribution CDF ───────────────────────────────────────────────
// Used by both TDistNode and TInvNode.
function tDistCDF(x: number, df: number): number {
  const t2 = x * x;
  const z = df / (df + t2);
  const betaCDF = regularizedBeta(z, df / 2, 0.5);
  return x >= 0 ? 1 - betaCDF / 2 : betaCDF / 2;
}

// ─── 1. NormDistNode — NORM.DIST ──────────────────────────────────────────────
export type NormDistOp = "cdf" | "pdf";

export const NORM_DIST_OP_META = {
  cdf: { label: "CDF", description: "Cumulative probability Φ((x−μ)/σ). Excel: NORM.DIST with cumulative=TRUE." },
  pdf: { label: "PDF", description: "Probability density (bell curve height). Excel: NORM.DIST with cumulative=FALSE." },
} satisfies Record<NormDistOp, { label: string; description: string }>;

export class NormDistNode extends ClassicPreset.Node {
  label: string;
  op: NormDistOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 0, mean: 0, stdev: 1 };
  width = 180; height = 230;

  constructor(init?: { label?: string; op?: NormDistOp }) {
    super("NormDist");
    this.label = init?.label ?? "NORM.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",    numIn("X"));
    this.addInput("mean", numIn("Mean"));
    this.addInput("stdev", numIn("Stdev"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; mean?: number[]; stdev?: number[] }) {
    const x     = inputs.x?.[0]     ?? this.literals.x     ?? 0;
    const mean  = inputs.mean?.[0]  ?? this.literals.mean  ?? 0;
    const stdev = inputs.stdev?.[0] ?? this.literals.stdev ?? 1;
    let result: number | null = null;
    if (stdev > 0) {
      const z = (x - mean) / stdev;
      if (this.op === "cdf") {
        result = stdNormCDF(z);
      } else {
        result = exp(-0.5 * z * z) / (stdev * sqrt(2 * PI));
      }
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── 2. NormInvNode — NORM.INV ────────────────────────────────────────────────
export class NormInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { prob: 0.95, mean: 0, stdev: 1 };
  width = 180; height = 205;

  constructor(init?: { label?: string }) {
    super("NormInv");
    this.label = init?.label ?? "NORM.INV";
    this.addInput("prob",  numIn("Probability"));
    this.addInput("mean",  numIn("Mean"));
    this.addInput("stdev", numIn("Stdev"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { prob?: number[]; mean?: number[]; stdev?: number[] }) {
    const prob  = inputs.prob?.[0]  ?? this.literals.prob  ?? 0.95;
    const mean  = inputs.mean?.[0]  ?? this.literals.mean  ?? 0;
    const stdev = inputs.stdev?.[0] ?? this.literals.stdev ?? 1;
    let result: number | null = null;
    if (prob > 0 && prob < 1 && stdev > 0) {
      result = normSInv(prob) * stdev + mean;
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── 3. NormSDistNode — NORM.S.DIST ──────────────────────────────────────────
export type NormSDistOp = "cdf" | "pdf";

export const NORM_S_DIST_OP_META = {
  cdf: { label: "CDF", description: "Standard normal cumulative probability Φ(z). Excel: NORM.S.DIST with cumulative=TRUE." },
  pdf: { label: "PDF", description: "Standard normal probability density. Excel: NORM.S.DIST with cumulative=FALSE." },
} satisfies Record<NormSDistOp, { label: string; description: string }>;

export class NormSDistNode extends ClassicPreset.Node {
  label: string;
  op: NormSDistOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { z: 0 };
  width = 180; height = 175;

  constructor(init?: { label?: string; op?: NormSDistOp }) {
    super("NormSDist");
    this.label = init?.label ?? "NORM.S.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("z", numIn("Z"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { z?: number[] }) {
    const z = inputs.z?.[0] ?? this.literals.z ?? 0;
    let result: number | null = null;
    if (this.op === "cdf") {
      result = stdNormCDF(z);
    } else {
      result = exp(-z * z / 2) / sqrt(2 * PI);
    }
    if (!Number.isFinite(result)) result = null;
    this.cachedResult = result;
    return { result };
  }
}

// ─── 4. NormSInvNode — NORM.S.INV ────────────────────────────────────────────
export class NormSInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { prob: 0.95 };
  width = 180; height = 150;

  constructor(init?: { label?: string }) {
    super("NormSInv");
    this.label = init?.label ?? "NORM.S.INV";
    this.addInput("prob", numIn("Probability"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { prob?: number[] }) {
    const prob = inputs.prob?.[0] ?? this.literals.prob ?? 0.95;
    let result: number | null = null;
    if (prob > 0 && prob < 1) {
      result = normSInv(prob);
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── 5. TDistNode — T.DIST ───────────────────────────────────────────────────
export type TDistOp = "cdf" | "pdf" | "2t" | "rt";

export const T_DIST_OP_META = {
  cdf: { label: "CDF",  description: "Left-tail cumulative t-distribution. Excel: T.DIST." },
  pdf: { label: "PDF",  description: "Probability density function" },
  "2t": { label: "2T",  description: "Two-tailed probability. Excel: T.DIST.2T." },
  rt:  { label: "RT",   description: "Right-tail (upper) probability. Excel: T.DIST.RT." },
} satisfies Record<TDistOp, { label: string; description: string }>;

export class TDistNode extends ClassicPreset.Node {
  label: string;
  op: TDistOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 0, df: 10 };
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: TDistOp }) {
    super("TDist");
    this.label = init?.label ?? "T.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",  numIn("X"));
    this.addInput("df", numIn("Degrees of freedom"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; df?: number[] }) {
    const x  = inputs.x?.[0]  ?? this.literals.x  ?? 0;
    const df = inputs.df?.[0] ?? this.literals.df ?? 10;
    let result: number | null = null;
    if (df > 0) {
      switch (this.op) {
        case "cdf": {
          result = tDistCDF(x, df);
          break;
        }
        case "pdf": {
          result = exp(
            lnGamma((df + 1) / 2) - lnGamma(df / 2)
          ) / (sqrt(df * PI) * Math.pow(1 + x * x / df, (df + 1) / 2));
          break;
        }
        case "2t": {
          result = 2 * (1 - tDistCDF(abs(x), df));
          break;
        }
        case "rt": {
          result = 1 - tDistCDF(x, df);
          break;
        }
      }
      if (result !== null && !Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── 6. TInvNode — T.INV ─────────────────────────────────────────────────────
export type TInvOp = "left" | "2t";

export const T_INV_OP_META = {
  left: { label: "Left",     description: "Inverse of left-tail t-distribution. Excel: T.INV." },
  "2t": { label: "Two-tail", description: "Inverse of two-tailed t-distribution. Excel: T.INV.2T." },
} satisfies Record<TInvOp, { label: string; description: string }>;

export class TInvNode extends ClassicPreset.Node {
  label: string;
  op: TInvOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { prob: 0.95, df: 10 };
  width = 180; height = 195;

  constructor(init?: { label?: string; op?: TInvOp }) {
    super("TInv");
    this.label = init?.label ?? "T.INV";
    this.op = init?.op ?? "left";
    this.addInput("prob", numIn("Probability"));
    this.addInput("df",   numIn("Degrees of freedom"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { prob?: number[]; df?: number[] }) {
    const prob = inputs.prob?.[0] ?? this.literals.prob ?? 0.95;
    const df   = inputs.df?.[0]   ?? this.literals.df   ?? 10;
    let result: number | null = null;
    if (prob > 0 && prob < 1 && df > 0) {
      if (this.op === "left") {
        result = bisectionInv((t) => tDistCDF(t, df), prob, -1e6, 1e6);
      } else {
        // 2T: find t where left-CDF(t) = 1 - prob/2
        result = bisectionInv((t) => tDistCDF(t, df), 1 - prob / 2, -1e6, 1e6);
      }
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── 7. ChisqDistNode — CHISQ.DIST ────────────────────────────────────────────
export type ChisqDistOp = "cdf" | "pdf" | "rt";

export const CHISQ_DIST_OP_META = {
  cdf: { label: "CDF",        description: "Left-tail chi-squared CDF. Excel: CHISQ.DIST." },
  pdf: { label: "PDF",        description: "Probability density" },
  rt:  { label: "Right-tail", description: "Right-tail probability. Excel: CHISQ.DIST.RT." },
} satisfies Record<ChisqDistOp, { label: string; description: string }>;

export class ChisqDistNode extends ClassicPreset.Node {
  label: string;
  op: ChisqDistOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 1, df: 5 };
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: ChisqDistOp }) {
    super("ChisqDist");
    this.label = init?.label ?? "CHISQ.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",  numIn("X"));
    this.addInput("df", numIn("Degrees of freedom"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; df?: number[] }) {
    const x  = inputs.x?.[0]  ?? this.literals.x  ?? 1;
    const df = inputs.df?.[0] ?? this.literals.df ?? 5;
    let result: number | null = null;
    if (df > 0) {
      const cdfVal = x <= 0 ? 0 : regularizedGamma(df / 2, x / 2);
      switch (this.op) {
        case "cdf": {
          result = cdfVal;
          break;
        }
        case "pdf": {
          result = x <= 0
            ? 0
            : exp(-x / 2 + (df / 2 - 1) * log(x) - (df / 2) * log(2) - lnGamma(df / 2));
          break;
        }
        case "rt": {
          result = 1 - cdfVal;
          break;
        }
      }
      if (result !== null && !Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── 8. ChisqInvNode — CHISQ.INV ─────────────────────────────────────────────
export type ChisqInvOp = "left" | "rt";

export const CHISQ_INV_OP_META = {
  left: { label: "Left",        description: "Inverse of left-tail chi-squared. Excel: CHISQ.INV." },
  rt:   { label: "Right-tail",  description: "Inverse of right-tail chi-squared. Excel: CHISQ.INV.RT." },
} satisfies Record<ChisqInvOp, { label: string; description: string }>;

export class ChisqInvNode extends ClassicPreset.Node {
  label: string;
  op: ChisqInvOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { prob: 0.95, df: 5 };
  width = 180; height = 195;

  constructor(init?: { label?: string; op?: ChisqInvOp }) {
    super("ChisqInv");
    this.label = init?.label ?? "CHISQ.INV";
    this.op = init?.op ?? "left";
    this.addInput("prob", numIn("Probability"));
    this.addInput("df",   numIn("Degrees of freedom"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { prob?: number[]; df?: number[] }) {
    const prob = inputs.prob?.[0] ?? this.literals.prob ?? 0.95;
    const df   = inputs.df?.[0]   ?? this.literals.df   ?? 5;
    let result: number | null = null;
    if (prob > 0 && prob < 1 && df > 0) {
      const target = this.op === "left" ? prob : 1 - prob;
      result = bisectionInv((x) => regularizedGamma(df / 2, x / 2), target, 0, 1e6);
      if (!Number.isFinite(result)) result = null;
    }
    this.cachedResult = result;
    return { result };
  }
}
