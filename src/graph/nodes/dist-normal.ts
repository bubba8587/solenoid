import { ClassicPreset } from "rete";
import { numListIn, numListOut, readInput, broadcast, type BroadcastResult } from "./shared";
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
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 0, mean: 0, stdev: 1 };
  width = 180; height = 230;

  constructor(init?: { label?: string; op?: NormDistOp }) {
    super("NormDist");
    this.label = init?.label ?? "NORM.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",    numListIn("X"));
    this.addInput("mean", numListIn("Mean"));
    this.addInput("stdev", numListIn("Stdev"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const x     = readInput(inputs.x,     this.literals.x);
    const mean  = readInput(inputs.mean,  this.literals.mean);
    const stdev = readInput(inputs.stdev, this.literals.stdev);
    const op = this.op;
    const result = broadcast((xv, mv, sv) => {
      if (sv <= 0) return null;
      const z = (xv - mv) / sv;
      const r = op === "cdf" ? stdNormCDF(z) : exp(-0.5 * z * z) / (sv * sqrt(2 * PI));
      return Number.isFinite(r) ? r : null;
    }, x, mean, stdev);
    this.cachedResult = result;
    return { result };
  }
}

// ─── 2. NormInvNode — NORM.INV ────────────────────────────────────────────────
export class NormInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { prob: 0.95, mean: 0, stdev: 1 };
  width = 180; height = 205;

  constructor(init?: { label?: string }) {
    super("NormInv");
    this.label = init?.label ?? "NORM.INV";
    this.addInput("prob",  numListIn("Probability"));
    this.addInput("mean",  numListIn("Mean"));
    this.addInput("stdev", numListIn("Stdev"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const prob  = readInput(inputs.prob,  this.literals.prob);
    const mean  = readInput(inputs.mean,  this.literals.mean);
    const stdev = readInput(inputs.stdev, this.literals.stdev);
    const result = broadcast((pv, mv, sv) => {
      if (pv <= 0 || pv >= 1 || sv <= 0) return null;
      const r = normSInv(pv) * sv + mv;
      return Number.isFinite(r) ? r : null;
    }, prob, mean, stdev);
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
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { z: 0 };
  width = 180; height = 175;

  constructor(init?: { label?: string; op?: NormSDistOp }) {
    super("NormSDist");
    this.label = init?.label ?? "NORM.S.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("z", numListIn("Z"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const z = readInput(inputs.z, this.literals.z);
    const op = this.op;
    const result = broadcast((zv) => {
      const r = op === "cdf" ? stdNormCDF(zv) : exp(-zv * zv / 2) / sqrt(2 * PI);
      return Number.isFinite(r) ? r : null;
    }, z);
    this.cachedResult = result;
    return { result };
  }
}

// ─── 4. NormSInvNode — NORM.S.INV ────────────────────────────────────────────
export class NormSInvNode extends ClassicPreset.Node {
  label: string;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { prob: 0.95 };
  width = 180; height = 150;

  constructor(init?: { label?: string }) {
    super("NormSInv");
    this.label = init?.label ?? "NORM.S.INV";
    this.addInput("prob", numListIn("Probability"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const prob = readInput(inputs.prob, this.literals.prob);
    const result = broadcast((pv) => {
      if (pv <= 0 || pv >= 1) return null;
      const r = normSInv(pv);
      return Number.isFinite(r) ? r : null;
    }, prob);
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
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 0, df: 10 };
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: TDistOp }) {
    super("TDist");
    this.label = init?.label ?? "T.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",  numListIn("X"));
    this.addInput("df", numListIn("Degrees of freedom"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const x  = readInput(inputs.x,  this.literals.x);
    const df = readInput(inputs.df, this.literals.df);
    const op = this.op;
    const result = broadcast((xv, dfv) => {
      if (dfv <= 0) return null;
      let r: number;
      if (op === "cdf") {
        r = tDistCDF(xv, dfv);
      } else if (op === "pdf") {
        r = exp(lnGamma((dfv + 1) / 2) - lnGamma(dfv / 2)) /
          (sqrt(dfv * PI) * Math.pow(1 + xv * xv / dfv, (dfv + 1) / 2));
      } else if (op === "2t") {
        r = 2 * (1 - tDistCDF(abs(xv), dfv));
      } else {
        r = 1 - tDistCDF(xv, dfv);
      }
      return Number.isFinite(r) ? r : null;
    }, x, df);
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
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { prob: 0.95, df: 10 };
  width = 180; height = 195;

  constructor(init?: { label?: string; op?: TInvOp }) {
    super("TInv");
    this.label = init?.label ?? "T.INV";
    this.op = init?.op ?? "left";
    this.addInput("prob", numListIn("Probability"));
    this.addInput("df",   numListIn("Degrees of freedom"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const prob = readInput(inputs.prob, this.literals.prob);
    const df   = readInput(inputs.df,   this.literals.df);
    const op = this.op;
    const result = broadcast((pv, dfv) => {
      if (pv <= 0 || pv >= 1 || dfv <= 0) return null;
      const target = op === "left" ? pv : 1 - pv / 2;
      const r = bisectionInv((t) => tDistCDF(t, dfv), target, -1e6, 1e6);
      return Number.isFinite(r) ? r : null;
    }, prob, df);
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
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 1, df: 5 };
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: ChisqDistOp }) {
    super("ChisqDist");
    this.label = init?.label ?? "CHISQ.DIST";
    this.op = init?.op ?? "cdf";
    this.addInput("x",  numListIn("X"));
    this.addInput("df", numListIn("Degrees of freedom"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const x  = readInput(inputs.x,  this.literals.x);
    const df = readInput(inputs.df, this.literals.df);
    const op = this.op;
    const result = broadcast((xv, dfv) => {
      if (dfv <= 0) return null;
      const cdfVal = xv <= 0 ? 0 : regularizedGamma(dfv / 2, xv / 2);
      let r: number;
      if (op === "cdf") {
        r = cdfVal;
      } else if (op === "pdf") {
        r = xv <= 0 ? 0 : exp(-xv / 2 + (dfv / 2 - 1) * log(xv) - (dfv / 2) * log(2) - lnGamma(dfv / 2));
      } else {
        r = 1 - cdfVal;
      }
      return Number.isFinite(r) ? r : null;
    }, x, df);
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
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { prob: 0.95, df: 5 };
  width = 180; height = 195;

  constructor(init?: { label?: string; op?: ChisqInvOp }) {
    super("ChisqInv");
    this.label = init?.label ?? "CHISQ.INV";
    this.op = init?.op ?? "left";
    this.addInput("prob", numListIn("Probability"));
    this.addInput("df",   numListIn("Degrees of freedom"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const prob = readInput(inputs.prob, this.literals.prob);
    const df   = readInput(inputs.df,   this.literals.df);
    const op = this.op;
    const result = broadcast((pv, dfv) => {
      if (pv <= 0 || pv >= 1 || dfv <= 0) return null;
      const target = op === "left" ? pv : 1 - pv;
      const r = bisectionInv((x) => regularizedGamma(dfv / 2, x / 2), target, 0, 1e6);
      return Number.isFinite(r) ? r : null;
    }, prob, df);
    this.cachedResult = result;
    return { result };
  }
}
