import { ClassicPreset } from "rete";
import { numListIn, numListOut, readInput, broadcast, isInverseOp, syncInverseInput, type BroadcastResult } from "./shared";
import {
  stdNormCDF,
  normSInv,
  regularizedGamma,
  regularizedBeta,
  lnGamma,
  bisectionInv,
} from "./mathUtils";

const { PI, exp, log, sqrt, abs } = Math;

function tDistCDF(x: number, df: number): number {
  const t2 = x * x;
  const z = df / (df + t2);
  const betaCDF = regularizedBeta(z, df / 2, 0.5);
  return x >= 0 ? 1 - betaCDF / 2 : betaCDF / 2;
}

// ─── Normal ───────────────────────────────────────────────────────────────────

export type NormDistOp = "cdf" | "pdf" | "inv";

export const NORM_DIST_OP_META = {
  cdf: { label: "CDF",     description: "Cumulative probability Φ((x−μ)/σ). Excel: NORM.DIST with cumulative=TRUE." },
  pdf: { label: "PDF",     description: "Probability density (bell curve height). Excel: NORM.DIST with cumulative=FALSE." },
  inv: { label: "Inverse", description: "The x at cumulative probability p (the quantile). Excel: NORM.INV." },
} satisfies Record<NormDistOp, { label: string; description: string }>;

export class NormDistNode extends ClassicPreset.Node {
  label: string;
  op: NormDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 0, prob: 0.95, mean: 0, stdev: 1 };
  readonly xKey = "x";
  readonly paramKeys = ["mean", "stdev"];
  width = 180; height = 230;

  constructor(init?: { label?: string; op?: NormDistOp }) {
    super("NormDist");
    this.label = init?.label ?? "Normal";
    this.op = init?.op ?? "cdf";
    syncInverseInput(this, this.op, this.xKey, "X");
    this.addInput("mean",  numListIn("Mean"));
    this.addInput("stdev", numListIn("Stdev"));
    this.addOutput("result", numListOut("Result"));
  }

  setOp(next: NormDistOp): void {
    this.op = next;
    syncInverseInput(this, next, this.xKey, "X");
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const mean  = readInput(inputs.mean,  this.literals.mean);
    const stdev = readInput(inputs.stdev, this.literals.stdev);
    const op = this.op;
    const first = op === "inv"
      ? readInput(inputs.prob, this.literals.prob)
      : readInput(inputs.x, this.literals.x);
    const result = broadcast((fv, mv, sv) => {
      if (sv <= 0) return null;
      let r: number;
      if (op === "inv") {
        if (fv <= 0 || fv >= 1) return null;
        r = normSInv(fv) * sv + mv;
      } else {
        const z = (fv - mv) / sv;
        r = op === "cdf" ? stdNormCDF(z) : exp(-0.5 * z * z) / (sv * sqrt(2 * PI));
      }
      return Number.isFinite(r) ? r : null;
    }, first, mean, stdev);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Standard Normal ──────────────────────────────────────────────────────────

export type NormSDistOp = "cdf" | "pdf" | "inv";

export const NORM_S_DIST_OP_META = {
  cdf: { label: "CDF",     description: "Standard normal cumulative probability Φ(z). Excel: NORM.S.DIST with cumulative=TRUE." },
  pdf: { label: "PDF",     description: "Standard normal probability density. Excel: NORM.S.DIST with cumulative=FALSE." },
  inv: { label: "Inverse", description: "The z at cumulative probability p (the quantile). Excel: NORM.S.INV." },
} satisfies Record<NormSDistOp, { label: string; description: string }>;

export class NormSDistNode extends ClassicPreset.Node {
  label: string;
  op: NormSDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { z: 0, prob: 0.95 };
  readonly xKey = "z";
  readonly paramKeys: string[] = [];
  width = 180; height = 175;

  constructor(init?: { label?: string; op?: NormSDistOp }) {
    super("NormSDist");
    this.label = init?.label ?? "Standard Normal";
    this.op = init?.op ?? "cdf";
    syncInverseInput(this, this.op, this.xKey, "Z");
    this.addOutput("result", numListOut("Result"));
  }

  setOp(next: NormSDistOp): void {
    this.op = next;
    syncInverseInput(this, next, this.xKey, "Z");
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const op = this.op;
    const first = op === "inv"
      ? readInput(inputs.prob, this.literals.prob)
      : readInput(inputs.z, this.literals.z);
    const result = broadcast((v) => {
      let r: number;
      if (op === "inv") {
        if (v <= 0 || v >= 1) return null;
        r = normSInv(v);
      } else {
        r = op === "cdf" ? stdNormCDF(v) : exp(-v * v / 2) / sqrt(2 * PI);
      }
      return Number.isFinite(r) ? r : null;
    }, first);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Student's t ──────────────────────────────────────────────────────────────

export type TDistOp = "cdf" | "pdf" | "2t" | "rt" | "inv" | "inv2t";

export const T_DIST_OP_META = {
  cdf:   { label: "CDF",        description: "Left-tail cumulative t-distribution. Excel: T.DIST." },
  pdf:   { label: "PDF",        description: "Probability density function" },
  "2t":  { label: "2T",         description: "Two-tailed probability. Excel: T.DIST.2T." },
  rt:    { label: "RT",         description: "Right-tail (upper) probability. Excel: T.DIST.RT." },
  inv:   { label: "Inverse",    description: "The t at left-tail probability p. Excel: T.INV." },
  inv2t: { label: "Inverse 2T", description: "The positive t with two-tailed probability p. Excel: T.INV.2T." },
} satisfies Record<TDistOp, { label: string; description: string }>;

export class TDistNode extends ClassicPreset.Node {
  label: string;
  op: TDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 0, prob: 0.95, df: 10 };
  readonly xKey = "x";
  readonly paramKeys = ["df"];
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: TDistOp }) {
    super("TDist");
    this.label = init?.label ?? "t-distribution";
    this.op = init?.op ?? "cdf";
    syncInverseInput(this, this.op, this.xKey, "X");
    this.addInput("df", numListIn("Degrees of freedom"));
    this.addOutput("result", numListOut("Result"));
  }

  setOp(next: TDistOp): void {
    this.op = next;
    syncInverseInput(this, next, this.xKey, "X");
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const df = readInput(inputs.df, this.literals.df);
    const op = this.op;
    const first = isInverseOp(op)
      ? readInput(inputs.prob, this.literals.prob)
      : readInput(inputs.x, this.literals.x);
    const result = broadcast((v, dfv) => {
      if (dfv <= 0) return null;
      let r: number;
      if (op === "inv" || op === "inv2t") {
        if (v <= 0 || v >= 1) return null;
        const target = op === "inv" ? v : 1 - v / 2;
        r = bisectionInv((t) => tDistCDF(t, dfv), target, -1e6, 1e6);
      } else if (op === "cdf") {
        r = tDistCDF(v, dfv);
      } else if (op === "pdf") {
        r = exp(lnGamma((dfv + 1) / 2) - lnGamma(dfv / 2)) /
          (sqrt(dfv * PI) * Math.pow(1 + v * v / dfv, (dfv + 1) / 2));
      } else if (op === "2t") {
        r = 2 * (1 - tDistCDF(abs(v), dfv));
      } else {
        r = 1 - tDistCDF(v, dfv);
      }
      return Number.isFinite(r) ? r : null;
    }, first, df);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Chi-squared ──────────────────────────────────────────────────────────────

export type ChisqDistOp = "cdf" | "pdf" | "rt" | "inv" | "invrt";

export const CHISQ_DIST_OP_META = {
  cdf:   { label: "CDF",        description: "Left-tail chi-squared CDF. Excel: CHISQ.DIST." },
  pdf:   { label: "PDF",        description: "Probability density" },
  rt:    { label: "RT",         description: "Right-tail probability. Excel: CHISQ.DIST.RT." },
  inv:   { label: "Inverse",    description: "The x at left-tail probability p. Excel: CHISQ.INV." },
  invrt: { label: "Inverse RT", description: "The x at right-tail probability p. Excel: CHISQ.INV.RT." },
} satisfies Record<ChisqDistOp, { label: string; description: string }>;

export class ChisqDistNode extends ClassicPreset.Node {
  label: string;
  op: ChisqDistOp;
  cachedResult: BroadcastResult = null;
  literals: Record<string, number> = { x: 1, prob: 0.95, df: 5 };
  readonly xKey = "x";
  readonly paramKeys = ["df"];
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: ChisqDistOp }) {
    super("ChisqDist");
    this.label = init?.label ?? "Chi-squared";
    this.op = init?.op ?? "cdf";
    syncInverseInput(this, this.op, this.xKey, "X");
    this.addInput("df", numListIn("Degrees of freedom"));
    this.addOutput("result", numListOut("Result"));
  }

  setOp(next: ChisqDistOp): void {
    this.op = next;
    syncInverseInput(this, next, this.xKey, "X");
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    const df = readInput(inputs.df, this.literals.df);
    const op = this.op;
    const first = isInverseOp(op)
      ? readInput(inputs.prob, this.literals.prob)
      : readInput(inputs.x, this.literals.x);
    const result = broadcast((v, dfv) => {
      if (dfv <= 0) return null;
      let r: number;
      if (op === "inv" || op === "invrt") {
        if (v <= 0 || v >= 1) return null;
        const target = op === "inv" ? v : 1 - v;
        r = bisectionInv((x) => regularizedGamma(dfv / 2, x / 2), target, 0, 1e6);
      } else {
        const cdfVal = v <= 0 ? 0 : regularizedGamma(dfv / 2, v / 2);
        if (op === "cdf") {
          r = cdfVal;
        } else if (op === "pdf") {
          r = v <= 0 ? 0 : exp(-v / 2 + (dfv / 2 - 1) * log(v) - (dfv / 2) * log(2) - lnGamma(dfv / 2));
        } else {
          r = 1 - cdfVal;
        }
      }
      return Number.isFinite(r) ? r : null;
    }, first, df);
    this.cachedResult = result;
    return { result };
  }
}
