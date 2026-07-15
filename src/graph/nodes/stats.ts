import { ClassicPreset } from "rete";
import { broadcastErr, listIn, listOut, numIn, numOut, numListIn, numListOut, readInput, tableIn, tableOut } from "./shared";
import { normSInv, regularizedBeta, regularizedGamma, stdNormCDF, lnCombin, bisectionInv, iterMax } from "./mathUtils";
import { solError, isSolError, type SolError } from "../errorValue";
import { excelRank, excelTrimmean, excelPercentRank } from "../excelFunctions";
import { forAggregate } from "../valueKinds";

// Pair two parallel sample lists for a bivariate stat (CORREL/COVARIANCE/regression):
// propagate the first SolError in either list (error-in → error-out), and drop any
// index where either side is null/missing so a blank isn't silently scored as 0.
// NaN is kept (matches the univariate forAggregate). Clean number lists pass through
// unchanged, so this only changes behavior when a null/error is actually present.
function forPair(
  xsRaw: (number | null | SolError)[] | null,
  ysRaw: (number | null | SolError)[] | null,
): { error?: SolError; xs: number[]; ys: number[] } {
  const xs = xsRaw ?? [], ys = ysRaw ?? [];
  for (const v of xs) if (isSolError(v)) return { error: v, xs: [], ys: [] };
  for (const v of ys) if (isSolError(v)) return { error: v, xs: [], ys: [] };
  const n = Math.min(xs.length, ys.length);
  const ox: number[] = [], oy: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = xs[i], b = ys[i];
    if (a === null || b === null) continue; // missing in either → drop the pair
    ox.push(a as number); oy.push(b as number);
  }
  return { xs: ox, ys: oy };
}

// ─── Statistics nodes ─────────────────────────────────────────────────────────

export type NthValueOp = "large" | "small";

export const NTH_VALUE_OP_META = {
  large: { label: "LARGE", description: "Kth largest value. Excel: LARGE." },
  small: { label: "SMALL", description: "Kth smallest value. Excel: SMALL." },
} satisfies Record<NthValueOp, { label: string; description: string }>;

export class NthValueNode extends ClassicPreset.Node {
  label: string;
  op: NthValueOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { k: 1 };
  width = 180;
  height = 170;

  constructor(init?: { label?: string; op?: NthValueOp }) {
    super("NthValue");
    this.label = init?.label ?? "LARGE";
    this.op = init?.op ?? "large";
    this.addInput("list", listIn("List"));
    this.addInput("k",    numIn("K"));
    this.addOutput("result", numOut("Value"));
  }

  data(inputs: { list?: (number | null | SolError)[][]; k?: number[] }) {
    // SolError propagates; null (missing) is skipped before ranking.
    const prep = forAggregate(inputs.list?.[0] ?? []);
    if (prep.error) { this.cachedResult = prep.error; return { result: prep.error }; }
    const arr = prep.nums;
    const k = Math.round(inputs.k?.[0] ?? this.literals.k ?? 1);
    let result: number | null = null;
    if (arr.length > 0 && k >= 1 && k <= arr.length) {
      const sorted = [...arr].sort((a, b) => a - b);
      result = this.op === "large" ? sorted[arr.length - k] : sorted[k - 1];
    }
    this.cachedResult = result;
    return { result };
  }
}

export type PercentileMode = "inc" | "exc";

export class PercentileNode extends ClassicPreset.Node {
  label: string;
  op: PercentileMode;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { p: 0.5 };
  width = 180;
  height = 185;

  constructor(init?: { label?: string; op?: PercentileMode }) {
    super("Percentile");
    this.label = init?.label ?? "PERCENTILE";
    this.op = init?.op ?? "inc";
    this.addInput("list", listIn("List"));
    this.addInput("p",    numIn("Percentile (0–1)"));
    this.addOutput("result", numOut("Value"));
  }

  data(inputs: { list?: (number | null | SolError)[][]; p?: number[] }): { result: number | SolError | null } {
    // SolError propagates; null (missing) is skipped before ranking.
    const prep = forAggregate(inputs.list?.[0] ?? []);
    if (prep.error) { this.cachedResult = prep.error; return { result: prep.error }; }
    const arr = prep.nums;
    const p = inputs.p?.[0] ?? this.literals.p ?? 0.5;
    let result: number | null = null;
    if (arr.length > 0) {
      const sorted = [...arr].sort((a, b) => a - b);
      const n = sorted.length;
      if (this.op === "inc") {
        if (p < 0 || p > 1) {
          const err = solError("#DOMAIN!", "Percentile must be between 0 and 1");
          this.cachedResult = err; return { result: err };
        }
        const i = p * (n - 1);
        const lo = Math.floor(i), hi = Math.ceil(i);
        result = sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
      } else {
        // Excel PERCENTILE.EXC: p must lie strictly inside (1/(n+1), n/(n+1)) —
        // outside it Excel returns #NUM!. Clamping here silently returned the
        // min/max element instead.
        if (p < 1 / (n + 1) || p > n / (n + 1)) {
          const err = solError("#DOMAIN!", "Percentile is outside the EXC domain: it must lie strictly between 1/(n+1) and n/(n+1)");
          this.cachedResult = err; return { result: err };
        }
        const i = p * (n + 1) - 1;
        const lo = Math.floor(i), hi = Math.min(n - 1, Math.ceil(i));
        result = sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

export type QuartileMode = "inc" | "exc";

export class QuartileNode extends ClassicPreset.Node {
  label: string;
  op: QuartileMode;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { q: 2 };
  width = 180;
  height = 185;

  constructor(init?: { label?: string; op?: QuartileMode }) {
    super("Quartile");
    this.label = init?.label ?? "QUARTILE";
    this.op = init?.op ?? "inc";
    this.addInput("list", listIn("List"));
    this.addInput("q",    numIn("Quartile (0–4)"));
    this.addOutput("result", numOut("Value"));
  }

  data(inputs: { list?: (number | null | SolError)[][]; q?: number[] }): { result: number | SolError | null } {
    // SolError propagates; null (missing) is skipped before ranking (matches Percentile).
    const prep = forAggregate(inputs.list?.[0] ?? []);
    if (prep.error) { this.cachedResult = prep.error; return { result: prep.error }; }
    const arr = prep.nums;
    const q = Math.round(inputs.q?.[0] ?? this.literals.q ?? 2);
    let result: number | null = null;
    if (arr.length > 0 && q >= 0 && q <= 4) {
      if (this.op === "exc" && (q === 0 || q === 4)) {
        const err = solError("#DOMAIN!", "QUARTILE.EXC is undefined for quartile 0 or 4");
        this.cachedResult = err; return { result: err };
      }
      const p = q / 4;
      const sorted = [...arr].sort((a, b) => a - b);
      const n = sorted.length;
      if (this.op === "inc") {
        const i = p * (n - 1);
        const lo = Math.floor(i), hi = Math.ceil(i);
        result = sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
      } else {
        // QUARTILE.EXC(q) is PERCENTILE.EXC(q/4): p must lie in [1/(n+1), n/(n+1)]
        // or Excel returns #NUM! — clamping (as this did) silently returned the
        // min/max element instead. Same fix as PercentileNode EXC above; the q=0/4
        // guard catches the endpoints, this catches an interior q at small n.
        if (p < 1 / (n + 1) || p > n / (n + 1)) {
          const err = solError("#DOMAIN!", "Quartile is outside the EXC domain: q/4 must lie between 1/(n+1) and n/(n+1)");
          this.cachedResult = err; return { result: err };
        }
        const i = p * (n + 1) - 1;
        const lo = Math.floor(i), hi = Math.min(n - 1, Math.ceil(i));
        result = sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

export type PercentrankMode = "inc" | "exc";

export class PercentrankNode extends ClassicPreset.Node {
  label: string;
  op: PercentrankMode;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { value: 0, significance: 3 };
  width = 180;
  height = 210;

  constructor(init?: { label?: string; op?: PercentrankMode }) {
    super("Percentrank");
    this.label = init?.label ?? "PERCENTRANK";
    this.op = init?.op ?? "inc";
    this.addInput("list",         listIn("List"));
    this.addInput("value",        numIn("Value"));
    this.addInput("significance", numIn("Digits"));
    this.addOutput("result", numOut("Rank (0–1)"));
  }

  data(inputs: { list?: number[][]; value?: number[]; significance?: number[] }): { result: number | SolError | null } {
    const arr = inputs.list?.[0] ?? null;
    const v = inputs.value?.[0] ?? this.literals.value ?? null;
    const sig = Math.round(inputs.significance?.[0] ?? this.literals.significance ?? 3);
    if (!arr || arr.length === 0 || v === null) { this.cachedResult = null; return { result: null }; }
    // Shared with the formula path (excelFunctions `excelPercentRank`) — interpolates
    // between data points + truncates to `sig` digits, matching Excel. One impl both call.
    const result = excelPercentRank(arr, v, sig, this.op === "exc");
    this.cachedResult = result;
    return { result };
  }
}

export type RankOp = "eq" | "avg";

export const RANK_OP_META = {
  eq:  { label: "RANK.EQ",  description: "Rank; ties share the lowest rank. Excel: RANK.EQ." },
  avg: { label: "RANK.AVG", description: "Rank; ties share the average rank. Excel: RANK.AVG." },
} satisfies Record<RankOp, { label: string; description: string }>;

export class RankNode extends ClassicPreset.Node {
  label: string;
  op: RankOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { value: 0 };
  width = 180;
  height = 185;

  constructor(init?: { label?: string; op?: RankOp }) {
    super("Rank");
    this.label = init?.label ?? "RANK";
    this.op = init?.op ?? "eq";
    this.addInput("list",  listIn("List"));
    this.addInput("value", numIn("Value"));
    this.addOutput("result", numOut("Rank"));
  }

  data(inputs: { list?: number[][]; value?: number[] }): { result: number | SolError | null } {
    const arr = inputs.list?.[0] ?? null;
    const v = inputs.value?.[0] ?? this.literals.value ?? null;
    if (!arr || arr.length === 0 || v === null) { this.cachedResult = null; return { result: null }; }
    // Shared with the formula path (excelFunctions `excelRank`) — one impl both call.
    const result = excelRank(v, arr, this.op === "avg");
    this.cachedResult = result;
    return { result };
  }
}

export type CorrelOp = "correl" | "rsq";

export const CORREL_OP_META = {
  correl: { label: "CORREL", description: "Pearson correlation r between two lists. Excel: CORREL." },
  rsq:    { label: "RSQ",    description: "R², the square of the correlation coefficient. Excel: RSQ." },
} satisfies Record<CorrelOp, { label: string; description: string }>;

export class CorrelNode extends ClassicPreset.Node {
  label: string;
  op: CorrelOp;
  cachedResult: number | SolError | null = null;
  width = 180;
  height = 170;

  constructor(init?: { label?: string; op?: CorrelOp }) {
    super("Correl");
    this.label = init?.label ?? "CORREL";
    this.op = init?.op ?? "correl";
    this.addInput("x", listIn("X"));
    this.addInput("y", listIn("Y"));
    this.addOutput("result", numOut("r"));
  }

  data(inputs: { x?: (number | null | SolError)[][]; y?: (number | null | SolError)[][] }): { result: number | SolError | null } {
    const { error, xs, ys } = forPair(inputs.x?.[0] ?? null, inputs.y?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    let result: number | null = null;
    if (xs.length >= 2 && ys.length >= 2) {
      const n = Math.min(xs.length, ys.length);
      const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
      let num = 0, dx2 = 0, dy2 = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
      }
      const den = Math.sqrt(dx2 * dy2);
      // Zero variance in either list — correlation is undefined (#DIV/0!).
      if (den === 0) {
        const err = solError("#DIV/0!", "One of the lists has zero variance");
        this.cachedResult = err; return { result: err };
      }
      const r = num / den;
      result = this.op === "rsq" ? r * r : r;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Standardize ──────────────────────────────────────────────────────────────
export class StandardizeNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | (number | SolError | null)[] | SolError | null = null;
  literals: Record<string, number> = { value: 0, mean: 0, stdev: 1 };
  width = 180; height = 220;

  constructor(init?: { label?: string }) {
    super("Standardize");
    this.label = init?.label ?? "STANDARDIZE";
    this.addInput("value", numListIn("Value"));
    this.addInput("mean",  numListIn("Mean"));
    this.addInput("stdev", numListIn("Std dev"));
    this.addOutput("result", numListOut("z-score"));
  }

  data(inputs: { value?: (number | number[])[]; mean?: (number | number[])[]; stdev?: (number | number[])[] }): { result: number | (number | SolError | null)[] | SolError | null } {
    const v = inputs.value?.[0] ?? this.literals.value ?? null;
    const m = inputs.mean?.[0]  ?? this.literals.mean  ?? null;
    const s = inputs.stdev?.[0] ?? this.literals.stdev ?? null;
    // A zero std dev divides by zero — #DIV/0! — tagged the same at every
    // dimensionality: a scalar → a #DIV/0! scalar, a per-element zero sigma in a
    // LIST → a per-cell #DIV/0! (array-semantics: lists carry per-cell errors).
    const divZero = () => solError("#DIV/0!", "Standard deviation is zero");
    let result: number | (number | SolError | null)[] | SolError | null = null;
    if (v !== null && m !== null && s !== null) {
      result = broadcastErr((x, mu, sigma) => sigma === 0 ? divZero() : (x - mu) / sigma, v, m, s);
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Covariance ───────────────────────────────────────────────────────────────
export type CovarianceOp = "pop" | "samp";

export const COVARIANCE_OP_META = {
  pop:  { label: "COVARIANCE.P", description: "Population covariance: how two lists move together; divides by n. Use when you have every data point. Excel: COVARIANCE.P." },
  samp: { label: "COVARIANCE.S", description: "Sample covariance: how two lists move together; divides by n−1. Use for a sample of a bigger population. Excel: COVARIANCE.S." },
} satisfies Record<CovarianceOp, { label: string; description: string }>;

export class CovarianceNode extends ClassicPreset.Node {
  label: string;
  op: CovarianceOp;
  cachedResult: number | SolError | null = null;
  width = 180; height = 185;

  constructor(init?: { label?: string; op?: CovarianceOp }) {
    super("Covariance");
    this.label = init?.label ?? "COVARIANCE";
    this.op = init?.op ?? "pop";
    this.addInput("x", listIn("X"));
    this.addInput("y", listIn("Y"));
    this.addOutput("result", numOut("Covariance"));
  }

  data(inputs: { x?: (number | null | SolError)[][]; y?: (number | null | SolError)[][] }) {
    const { error, xs, ys } = forPair(inputs.x?.[0] ?? null, inputs.y?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    let result: number | null = null;
    if (xs.length >= 2 && ys.length >= 2) {
      const n = Math.min(xs.length, ys.length);
      const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const cov = xs.slice(0, n).reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
      result = this.op === "pop" ? cov / n : cov / (n - 1);
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Fisher ───────────────────────────────────────────────────────────────────
export type FisherOp = "fisher" | "fisherinv";

export const FISHER_OP_META = {
  fisher:    { label: "FISHER",    description: "Fisher transformation: atanh(x), valid for −1 < x < 1. Excel: FISHER." },
  fisherinv: { label: "FISHERINV", description: "Inverse Fisher: tanh(x). Excel: FISHERINV." },
} satisfies Record<FisherOp, { label: string; description: string }>;

export class FisherNode extends ClassicPreset.Node {
  label: string;
  op: FisherOp;
  cachedResult: number | (number | SolError | null)[] | SolError | null = null;
  literals: Record<string, number> = { value: 0 };
  width = 180; height = 180;

  constructor(init?: { label?: string; op?: FisherOp }) {
    super("Fisher");
    this.label = init?.label ?? "FISHER";
    this.op = init?.op ?? "fisher";
    this.addInput("value",   numListIn("Value"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: { value?: (number | number[])[] }): { result: number | (number | SolError | null)[] | SolError | null } {
    const v = inputs.value?.[0] ?? this.literals.value ?? null;
    // FISHER is only defined on the open interval (−1, 1). A value outside it is a
    // domain error — #DOMAIN! — tagged the same at every dimensionality (a scalar
    // → a #DOMAIN! scalar, a per-element miss in a LIST → a per-cell #DOMAIN!).
    const domainErr = () => solError("#DOMAIN!", "FISHER requires −1 < x < 1");
    let result: number | (number | SolError | null)[] | SolError | null = null;
    if (v !== null) {
      result = broadcastErr((x) => {
        if (this.op === "fisher")    return (x <= -1 || x >= 1) ? domainErr() : Math.atanh(x);
        if (this.op === "fisherinv") return Math.tanh(x);
        return null;
      }, v);
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Regression ───────────────────────────────────────────────────────────────

export type RegressionOp = "slope" | "intercept" | "steyx";

export const REGRESSION_OP_META = {
  slope:     { label: "SLOPE",     description: "Slope of linear regression line through known_ys and known_xs. Excel: SLOPE(known_ys, known_xs)." },
  intercept: { label: "INTERCEPT", description: "Y-intercept of linear regression line. Excel: INTERCEPT(known_ys, known_xs)." },
  steyx:     { label: "STEYX",     description: "Standard error of predicted y-values in linear regression. Excel: STEYX(known_ys, known_xs)." },
} satisfies Record<RegressionOp, { label: string; description: string }>;

export class RegressionNode extends ClassicPreset.Node {
  label: string;
  op: RegressionOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = {};
  width = 180;
  height = 185;

  constructor(init?: { label?: string; op?: RegressionOp }) {
    super("Regression");
    this.label = init?.label ?? "SLOPE";
    this.op = init?.op ?? "slope";
    this.addInput("ys", listIn("Known Ys"));
    this.addInput("xs", listIn("Known Xs"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { ys?: (number | null | SolError)[][]; xs?: (number | null | SolError)[][] }): { result: number | SolError | null } {
    const { error, xs: xsP, ys: ysP } = forPair(inputs.xs?.[0] ?? null, inputs.ys?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    const ys = ysP, xs = xsP;
    let result: number | null = null;
    if (ys.length >= 2 && xs.length >= 2) {
      const n = Math.min(ys.length, xs.length);
      const xMean = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const yMean = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
      let SSxy = 0, SSxx = 0, SSyy = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - xMean, dy = ys[i] - yMean;
        SSxy += dx * dy;
        SSxx += dx * dx;
        SSyy += dy * dy;
      }
      // Zero X variance means dividing by SSxx — the regression is undefined.
      if (SSxx === 0) {
        const err = solError("#DIV/0!", "Known Xs have zero variance");
        this.cachedResult = err;
        return { result: err };
      }
      const slope = SSxy / SSxx;
      const intercept = yMean - slope * xMean;
      if (this.op === "slope") {
        result = slope;
      } else if (this.op === "intercept") {
        result = intercept;
      } else {
        // steyx — needs at least 3 points for the (n−2) denominator; fewer is
        // "not enough data yet", a blank (null), not an error.
        result = n >= 3 ? Math.sqrt((SSyy - slope * SSxy) / (n - 2)) : null;
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Forecast ─────────────────────────────────────────────────────────────────

export class ForecastNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { x: 0 };
  width = 180;
  height = 215;

  constructor(init?: { label?: string }) {
    super("Forecast");
    this.label = init?.label ?? "FORECAST.LINEAR";
    this.addInput("x",  numIn("X"));
    this.addInput("ys", listIn("Known Ys"));
    this.addInput("xs", listIn("Known Xs"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { x?: number[]; ys?: (number | null | SolError)[][]; xs?: (number | null | SolError)[][] }): { result: number | SolError | null } {
    const x = inputs.x?.[0] ?? this.literals.x ?? 0;
    const { error, xs: xsP, ys: ysP } = forPair(inputs.xs?.[0] ?? null, inputs.ys?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    const ys = ysP, xs = xsP;
    let result: number | null = null;
    if (ys.length >= 2 && xs.length >= 2) {
      const n = Math.min(ys.length, xs.length);
      const xMean = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const yMean = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
      let SSxy = 0, SSxx = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - xMean, dy = ys[i] - yMean;
        SSxy += dx * dy;
        SSxx += dx * dx;
      }
      // Zero X variance — the linear fit divides by SSxx and is undefined.
      if (SSxx === 0) {
        const err = solError("#DIV/0!", "Known Xs have zero variance");
        this.cachedResult = err;
        return { result: err };
      }
      const slope = SSxy / SSxx;
      const intercept = yMean - slope * xMean;
      result = intercept + slope * x;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Mode ─────────────────────────────────────────────────────────────────────

export class ModeNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | number[] | SolError | null = null;
  width = 180;
  height = 135;

  constructor(init?: { label?: string }) {
    super("Mode");
    this.label = init?.label ?? "MODE";
    this.addInput("list", listIn("List"));
    // Number combo output (scalar OR list): ONE most-frequent value comes out as a
    // scalar; when several tie, ALL of them come out as a list — so there's no
    // arbitrary tie-break to pick (supersedes Excel's MODE.SNGL/MODE.MULT split).
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: { list?: (number | null | SolError)[][] }): { result: number | number[] | SolError | null } {
    // SolError propagates; null (missing) is skipped so it isn't counted as a mode.
    const prep = forAggregate(inputs.list?.[0] ?? []);
    if (prep.error) { this.cachedResult = prep.error; return { result: prep.error }; }
    const arr = prep.nums;
    let result: number | number[] | null = null;
    if (arr.length > 0) {
      const counts = new Map<number, number>();
      for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
      const maxCount = iterMax(counts.values());
      const modes = [...counts.entries()]
        .filter(([, c]) => c === maxCount)
        .map(([v]) => v)
        .sort((a, b) => a - b);
      result = modes.length === 1 ? modes[0] : modes; // one mode → scalar; a tie → the full list
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── TrimMean ─────────────────────────────────────────────────────────────────

export class TrimMeanNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = { percent: 0.1 };
  width = 180;
  height = 175;

  constructor(init?: { label?: string }) {
    super("TrimMean");
    this.label = init?.label ?? "TRIMMEAN";
    this.addInput("list",    listIn("List"));
    this.addInput("percent", numIn("Trim %"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { list?: number[][]; percent?: number[] }): { result: number | SolError | null } {
    const arr = inputs.list?.[0] ?? null;
    const percent = inputs.percent?.[0] ?? this.literals.percent ?? 0.1;
    if (!arr || arr.length === 0) { this.cachedResult = null; return { result: null }; }
    // Shared with the formula path (excelFunctions `excelTrimmean`) — one impl both call.
    const result = excelTrimmean(arr, percent);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Frequency ────────────────────────────────────────────────────────────────

export class FrequencyNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] = [];
  width = 180;
  height = 185;

  constructor(init?: { label?: string }) {
    super("Frequency");
    this.label = init?.label ?? "FREQUENCY";
    this.addInput("data", listIn("Data"));
    this.addInput("bins", listIn("Bins"));
    this.addOutput("result", listOut("Counts"));
  }

  data(inputs: { data?: number[][]; bins?: number[][] }) {
    const dataArr = inputs.data?.[0] ?? null;
    const binsArr = inputs.bins?.[0] ?? null;
    let result: number[] = [];
    if (dataArr && binsArr && binsArr.length > 0) {
      const sortedBins = [...binsArr].sort((a, b) => a - b);
      const k = sortedBins.length;
      const counts = new Array<number>(k + 1).fill(0);
      for (const v of dataArr) {
        let placed = false;
        for (let i = 0; i < k; i++) {
          if (v <= sortedBins[i]) {
            counts[i]++;
            placed = true;
            break;
          }
        }
        if (!placed) counts[k]++;
      }
      result = counts;
    }
    this.cachedList = result;
    return { result };
  }
}

// ─── Confidence ───────────────────────────────────────────────────────────────

export type ConfidenceOp = "norm" | "t";

export const CONFIDENCE_OP_META = {
  norm: { label: "NORM", description: "Confidence interval half-width using normal distribution. Excel: CONFIDENCE.NORM(alpha, stdev, n)." },
  t:    { label: "T",    description: "Confidence interval half-width using t-distribution. Excel: CONFIDENCE.T(alpha, stdev, n)." },
} satisfies Record<ConfidenceOp, { label: string; description: string }>;

function tCDF(x: number, df: number): number {
  const z = df / (df + x * x);
  const betaCDF = regularizedBeta(z, df / 2, 0.5);
  return x >= 0 ? 1 - betaCDF / 2 : betaCDF / 2;
}

function tInv(prob: number, df: number): number {
  return bisectionInv((x) => tCDF(x, df), prob, -1e6, 1e6);
}

export class ConfidenceNode extends ClassicPreset.Node {
  label: string;
  op: ConfidenceOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { alpha: 0.05, stdev: 1, n: 30 };
  width = 180;
  height = 235;

  constructor(init?: { label?: string; op?: ConfidenceOp }) {
    super("Confidence");
    this.label = init?.label ?? "CONFIDENCE.NORM";
    this.op = init?.op ?? "norm";
    this.addInput("alpha", numIn("Alpha"));
    this.addInput("stdev", numIn("Std Dev"));
    this.addInput("n",     numIn("Sample size"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { alpha?: number[]; stdev?: number[]; n?: number[] }) {
    const alpha = inputs.alpha?.[0] ?? this.literals.alpha ?? 0.05;
    const stdev = inputs.stdev?.[0] ?? this.literals.stdev ?? 1;
    const n = Math.round(inputs.n?.[0] ?? this.literals.n ?? 30);
    let result: number | null = null;
    if (n >= 1 && stdev > 0 && alpha > 0 && alpha < 1) {
      if (this.op === "norm") {
        const z = normSInv(1 - alpha / 2);
        result = z * stdev / Math.sqrt(n);
      } else {
        if (n >= 2) {
          const t = tInv(1 - alpha / 2, n - 1);
          result = t * stdev / Math.sqrt(n);
        }
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── Shared helpers for test nodes ────────────────────────────────────────────

function arrMean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function arrSampleVar(arr: number[]): number {
  const m = arrMean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}
function binomPmfLocal(k: number, n: number, p: number): number | null {
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  const r = Math.exp(lnCombin(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  return Number.isFinite(r) ? r : null;
}

// ─── Z.TEST ───────────────────────────────────────────────────────────────────

export class ZTestNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { x: 0 };
  width = 180; height = 200;

  constructor(init?: { label?: string }) {
    super("ZTest");
    this.label = init?.label ?? "Z.TEST";
    this.addInput("array", listIn("Array"));
    this.addInput("x",     numIn("μ₀"));
    this.addInput("sigma", numIn("σ (optional)"));
    this.addOutput("result", numOut("p-value (upper)"));
  }

  data(inputs: { array?: number[][]; x?: number[]; sigma?: number[] }) {
    const arr   = inputs.array?.[0] ?? null;
    const x     = inputs.x?.[0]     ?? this.literals.x ?? 0;
    const sigma = inputs.sigma?.[0] ?? null;
    let result: number | null = null;
    if (arr && arr.length >= 2) {
      const n   = arr.length;
      const m   = arrMean(arr);
      const std = (sigma != null && sigma > 0) ? sigma : Math.sqrt(arrSampleVar(arr));
      if (std > 0) {
        const z = (m - x) / (std / Math.sqrt(n));
        result  = 1 - stdNormCDF(z);
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── T.TEST ───────────────────────────────────────────────────────────────────

export type TTestOp = "paired" | "equal-var" | "unequal-var";

export const T_TEST_OP_META = {
  paired:          { label: "Paired",       description: "Paired t-test: the same subjects measured twice. Excel: T.TEST type 1." },
  "equal-var":     { label: "Equal var",    description: "Two-sample t-test with pooled variance. Excel: T.TEST type 2." },
  "unequal-var":   { label: "Unequal var",  description: "Welch's t-test: variances may differ. Excel: T.TEST type 3." },
} satisfies Record<TTestOp, { label: string; description: string }>;

export class TTestNode extends ClassicPreset.Node {
  label: string;
  op: TTestOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = {};
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: TTestOp }) {
    super("TTest");
    this.label = init?.label ?? "T.TEST";
    this.op    = init?.op    ?? "equal-var";
    this.addInput("a", listIn("Array 1"));
    this.addInput("b", listIn("Array 2"));
    this.addOutput("result", numOut("p-value (2-tail)"));
  }

  data(inputs: { a?: number[][]; b?: number[][] }) {
    const a = inputs.a?.[0] ?? null;
    const b = inputs.b?.[0] ?? null;
    let result: number | null = null;
    if (a && b && a.length >= 2 && b.length >= 2) {
      let t: number, df: number;
      if (this.op === "paired") {
        const n     = Math.min(a.length, b.length);
        const diffs = Array.from({ length: n }, (_, i) => a[i] - b[i]);
        const dVar  = arrSampleVar(diffs);
        if (dVar <= 0) { this.cachedResult = null; return { result: null }; }
        t  = arrMean(diffs) / Math.sqrt(dVar / n);
        df = n - 1;
      } else if (this.op === "equal-var") {
        const n1 = a.length, n2 = b.length;
        const v1 = arrSampleVar(a), v2 = arrSampleVar(b);
        const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
        if (sp2 <= 0) { this.cachedResult = null; return { result: null }; }
        t  = (arrMean(a) - arrMean(b)) / Math.sqrt(sp2 * (1 / n1 + 1 / n2));
        df = n1 + n2 - 2;
      } else {
        const n1 = a.length, n2 = b.length;
        const v1n = arrSampleVar(a) / n1, v2n = arrSampleVar(b) / n2;
        const sum = v1n + v2n;
        if (sum <= 0) { this.cachedResult = null; return { result: null }; }
        t  = (arrMean(a) - arrMean(b)) / Math.sqrt(sum);
        df = sum ** 2 / (v1n ** 2 / (n1 - 1) + v2n ** 2 / (n2 - 1));
      }
      if (df > 0 && Number.isFinite(t) && Number.isFinite(df)) {
        const p = 2 * (1 - tCDF(Math.abs(t), df));
        result  = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : null;
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── F.TEST ───────────────────────────────────────────────────────────────────

export class FTestNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = {};
  width = 180; height = 170;

  constructor(init?: { label?: string }) {
    super("FTest");
    this.label = init?.label ?? "F.TEST";
    this.addInput("a", listIn("Array 1"));
    this.addInput("b", listIn("Array 2"));
    this.addOutput("result", numOut("p-value (2-tail)"));
  }

  data(inputs: { a?: number[][]; b?: number[][] }) {
    const a = inputs.a?.[0] ?? null;
    const b = inputs.b?.[0] ?? null;
    let result: number | null = null;
    if (a && b && a.length >= 2 && b.length >= 2) {
      const n1 = a.length, n2 = b.length;
      const v1 = arrSampleVar(a), v2 = arrSampleVar(b);
      if (v1 > 0 && v2 > 0) {
        const F  = v1 / v2;
        const df1 = n1 - 1, df2 = n2 - 1;
        const p1  = regularizedBeta((F * df1) / (F * df1 + df2), df1 / 2, df2 / 2);
        result = 2 * Math.min(p1, 1 - p1);
        if (!Number.isFinite(result)) result = null;
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── CHISQ.TEST ───────────────────────────────────────────────────────────────

export class ChisqTestNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = {};
  width = 180; height = 185;

  constructor(init?: { label?: string }) {
    super("ChisqTest");
    this.label = init?.label ?? "CHISQ.TEST";
    this.addInput("obs", listIn("Observed"));
    this.addInput("exp", listIn("Expected"));
    this.addOutput("result", numOut("p-value"));
  }

  data(inputs: { obs?: number[][]; exp?: number[][] }) {
    const obs = inputs.obs?.[0] ?? null;
    const exp = inputs.exp?.[0] ?? null;
    let result: number | null = null;
    if (obs && exp && obs.length >= 2 && exp.length >= obs.length) {
      const n = obs.length;
      let chi2 = 0;
      for (let i = 0; i < n; i++) {
        if (exp[i] <= 0) { chi2 = NaN; break; }
        chi2 += (obs[i] - exp[i]) ** 2 / exp[i];
      }
      if (Number.isFinite(chi2) && chi2 >= 0) {
        result = 1 - regularizedGamma((n - 1) / 2, chi2 / 2);
        if (!Number.isFinite(result)) result = null;
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── TREND ────────────────────────────────────────────────────────────────────

export class TrendNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] | SolError = [];
  literals: Record<string, number> = {};
  width = 180; height = 215;

  constructor(init?: { label?: string }) {
    super("Trend");
    this.label = init?.label ?? "TREND";
    this.addInput("ys",     listIn("Known Ys"));
    this.addInput("xs",     listIn("Known Xs"));
    this.addInput("new_xs", listIn("New Xs"));
    this.addOutput("result", listOut("Predicted Ys"));
  }

  data(inputs: { ys?: (number | null | SolError)[][]; xs?: (number | null | SolError)[][]; new_xs?: (number | null | SolError)[][] }) {
    const { error, xs, ys } = forPair(inputs.xs?.[0] ?? null, inputs.ys?.[0] ?? null);
    if (error) { this.cachedList = error; return { result: error }; }
    const newXsRaw = inputs.new_xs?.[0] ?? null;
    const newXsErr = newXsRaw?.find(isSolError);
    if (newXsErr) { this.cachedList = newXsErr; return { result: newXsErr }; }
    const newXs = (newXsRaw ?? []).filter((v): v is number => v !== null) as number[];
    let result: number[] = [];
    if (ys.length >= 2 && xs.length >= 2 && newXs.length > 0) {
      const n     = Math.min(ys.length, xs.length);
      const xMean = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const yMean = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
      let SSxy = 0, SSxx = 0;
      for (let i = 0; i < n; i++) {
        SSxy += (xs[i] - xMean) * (ys[i] - yMean);
        SSxx += (xs[i] - xMean) ** 2;
      }
      if (SSxx !== 0) {
        const slope     = SSxy / SSxx;
        const intercept = yMean - slope * xMean;
        result = newXs.map(x => intercept + slope * x);
      }
    }
    this.cachedList = result;
    return { result };
  }
}

// ─── Interpolate (List = 1-D, Grid = 2-D bilinear) ──────────────────────────────
// A true lookup-table interpolation, which Excel has no direct function for:
// LOOKUP/XLOOKUP do a STEP match (nearest key, no blending), and FORECAST/TREND fit a
// regression LINE through the cloud rather than honouring each point. One node, two
// modes (a dropdown swaps the socket set): LIST interpolates a 1-D dataset, GRID does
// 2-D bilinear resampling of a numeric table. Both CLAMP at the ends — a query beyond
// the known range returns the edge value; a lookup table (hardness conversion, a pump
// curve, a steam table) doesn't extrapolate past its data.

export type InterpolateMode = "list" | "grid";

export const INTERPOLATE_MODE_META: Record<InterpolateMode, { label: string; title: string }> = {
  list: { label: "List", title: "1-D: interpolate y for a query x between known (x, y) points" },
  grid: { label: "Grid", title: "2-D bilinear: resample a numeric grid onto new column/row coordinates" },
};

// The interpolation bracket for a query against a SORTED-ASCENDING axis: [i0, i1, t]
// with value = (1-t)·v[i0] + t·v[i1], clamped at both ends (t=0 outside the range).
function bracket(axis: number[], x: number): [number, number, number] {
  const last = axis.length - 1;
  if (x <= axis[0]) return [0, 0, 0];
  if (x >= axis[last]) return [last, last, 0];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] <= x) lo = mid; else hi = mid;
  }
  const x0 = axis[lo], x1 = axis[hi];
  return [lo, hi, x1 === x0 ? 0 : (x - x0) / (x1 - x0)]; // x1===x0: duplicated key, no gap
}

// 1-D piecewise-linear interpolation over a known (x, y) dataset. Points are sorted
// by x (known data may arrive unordered); a duplicated x resolves to its first-seen y
// (via bracket's t=0). A NaN query stays NaN. Clamped at the ends.
export function interpolateLinear(xs: number[], ys: number[], queryXs: number[]): number[] {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return queryXs.map(() => NaN);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) pairs.push([xs[i], ys[i]]);
  pairs.sort((a, b) => a[0] - b[0]);
  const sx = pairs.map((p) => p[0]);
  const sy = pairs.map((p) => p[1]);
  return queryXs.map((x) => {
    if (Number.isNaN(x)) return NaN;
    const [i0, i1, t] = bracket(sx, x);
    return sy[i0] + t * (sy[i1] - sy[i0]);
  });
}

// 2-D bilinear resampling: `grid[r][c]` is the Z value at (rowYs[r], colXs[c]). Sample
// it onto every (newYs × newXs) point → a newYs.length × newXs.length matrix. Axes are
// sorted ascending (the grid is permuted to match), so the row/column coordinates may
// arrive in any order. Clamped at every edge; a NaN query cell → NaN.
export function bilinearGrid(
  grid: number[][], colXs: number[], rowYs: number[], newXs: number[], newYs: number[],
): number[][] {
  const R = Math.min(grid.length, rowYs.length);
  const C = Math.min(colXs.length, grid[0]?.length ?? 0);
  if (R === 0 || C === 0) return newYs.map(() => newXs.map(() => NaN));
  const rowIdx = Array.from({ length: R }, (_, i) => i).sort((a, b) => rowYs[a] - rowYs[b]);
  const colIdx = Array.from({ length: C }, (_, j) => j).sort((a, b) => colXs[a] - colXs[b]);
  const sortedRowYs = rowIdx.map((i) => rowYs[i]);
  const sortedColXs = colIdx.map((j) => colXs[j]);
  const z = (sr: number, sc: number): number => grid[rowIdx[sr]][colIdx[sc]];
  return newYs.map((qy) =>
    newXs.map((qx) => {
      if (Number.isNaN(qx) || Number.isNaN(qy)) return NaN;
      const [r0, r1, ty] = bracket(sortedRowYs, qy);
      const [c0, c1, tx] = bracket(sortedColXs, qx);
      const top = z(r0, c0) + tx * (z(r0, c1) - z(r0, c0));
      const bot = z(r1, c0) + tx * (z(r1, c1) - z(r1, c0));
      return top + ty * (bot - top);
    }),
  );
}

/** Coerce a wired list to plain numbers (a null/error/blank cell → NaN). */
function axisNums(a: (number | null | SolError)[] | undefined): number[] {
  return (a ?? []).map((v) => (typeof v === "number" ? v : NaN));
}

export class InterpolateNode extends ClassicPreset.Node {
  label: string;
  mode: InterpolateMode;
  // LIST mode: scalar-or-list matching the query shape. GRID mode: a matrix. A whole-
  // input error propagates as a SolError.
  cachedResult: number | (number | null)[] | number[][] | SolError | null = null;
  literals: Record<string, number> = { x: 0 };
  width = 180; height = 215;

  constructor(init?: { label?: string; mode?: InterpolateMode }) {
    super("Interpolate");
    this.label = init?.label ?? "INTERPOLATE";
    this.mode = init?.mode ?? "list";
    this._rebuildSockets();
  }

  // Rebuild the I/O set for the current mode. The two modes are different operations
  // with different sockets (LIST: two data lists + a combo query; GRID: a numeric
  // table + four axis lists), so the dropdown swaps the whole set — see
  // applyInterpolateMode, which drops this node's cables first (removeInput is unsafe
  // while a cable references the socket).
  _rebuildSockets(): void {
    for (const key of Object.keys(this.inputs)) this.removeInput(key);
    for (const key of Object.keys(this.outputs)) this.removeOutput(key);
    if (this.mode === "grid") {
      this.addInput("grid",   tableIn("Grid Z"));
      this.addInput("xs",     listIn("Column Xs"));
      this.addInput("ys",     listIn("Row Ys"));
      this.addInput("new_xs", listIn("New Xs"));
      this.addInput("new_ys", listIn("New Ys"));
      this.addOutput("result", tableOut("Interpolated Grid"));
      this.height = 300;
      return;
    }
    this.addInput("ys",     listIn("Known Ys"));
    this.addInput("xs",     listIn("Known Xs"));
    // Query is a numlist COMBO (scalar-or-list): a single X in → a single y out,
    // a list of Xs in → a list out (result mirrors the query's shape).
    this.addInput("new_xs", numListIn("X"));
    this.addOutput("result", numListOut("Interpolated Y"));
    this.height = 215;
  }

  data(inputs: Record<string, unknown[]>): { result: number | (number | null)[] | number[][] | SolError | null } {
    return this.mode === "grid" ? this.dataGrid(inputs) : this.dataList(inputs);
  }

  private dataList(inputs: Record<string, unknown[]>): { result: number | (number | null)[] | SolError | null } {
    const xsIn = inputs.xs as (number | null | SolError)[][] | undefined;
    const ysIn = inputs.ys as (number | null | SolError)[][] | undefined;
    // Known data: propagate the first error, drop pairs missing on either side.
    const { error, xs, ys } = forPair(xsIn?.[0] ?? null, ysIn?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    // The combo query arrives as a scalar (a single X wired/typed) or an array (a
    // list wired) — readInput unwraps it and falls back to the literal when unwired.
    const q = readInput(inputs.new_xs as (number | (number | null | SolError)[] | null | SolError)[] | undefined, this.literals.x);
    if (isSolError(q)) { this.cachedResult = q; return { result: q }; }
    const noData = xs.length === 0;
    if (Array.isArray(q)) {
      const qErr = q.find(isSolError);
      if (qErr) { this.cachedResult = qErr as SolError; return { result: qErr as SolError }; }
      // No known points or no query → nothing to interpolate (empty, like TREND).
      if (noData || q.length === 0) { this.cachedResult = []; return { result: [] }; }
      // A missing (null) query stays missing IN PLACE; a real one gets its y.
      const nums = q.map((v) => (v === null ? NaN : (v as number)));
      const interp = interpolateLinear(xs, ys, nums);
      const result = q.map((v, i) => (v === null ? null : interp[i]));
      this.cachedResult = result;
      return { result };
    }
    // Scalar query → scalar result (a missing/no-data query yields null).
    if (q === null || noData) { this.cachedResult = null; return { result: null }; }
    const result = interpolateLinear(xs, ys, [q])[0];
    this.cachedResult = result;
    return { result };
  }

  private dataGrid(inputs: Record<string, unknown[]>): { result: number[][] | SolError } {
    const gridRaw = inputs.grid?.[0] ?? null;
    if (isSolError(gridRaw)) { this.cachedResult = gridRaw; return { result: gridRaw }; }
    // A dirty/missing/error cell → NaN (the grid interpolates numerically; a whole-
    // value error already short-circuited above).
    const grid = (Array.isArray(gridRaw) ? gridRaw : []).map((row) =>
      (Array.isArray(row) ? row : []).map((c) => (typeof c === "number" ? c : NaN)),
    );
    const colXs = axisNums((inputs.xs as (number | null | SolError)[][] | undefined)?.[0]);
    const rowYs = axisNums((inputs.ys as (number | null | SolError)[][] | undefined)?.[0]);
    const newXs = axisNums((inputs.new_xs as (number | null | SolError)[][] | undefined)?.[0]);
    const newYs = axisNums((inputs.new_ys as (number | null | SolError)[][] | undefined)?.[0]);
    if (grid.length === 0 || newXs.length === 0 || newYs.length === 0) {
      this.cachedResult = []; return { result: [] };
    }
    const result = bilinearGrid(grid, colXs, rowYs, newXs, newYs);
    this.cachedResult = result;
    return { result };
  }
}

// ─── LINEST ───────────────────────────────────────────────────────────────────

export class LinestNode extends ClassicPreset.Node {
  label: string;
  cachedSlope:     number | SolError | null = null;
  cachedIntercept: number | SolError | null = null;
  cachedR2:        number | SolError | null = null;
  width = 180; height = 200;

  constructor(init?: { label?: string }) {
    super("Linest");
    this.label = init?.label ?? "LINEST";
    this.addInput("ys", listIn("Known Ys"));
    this.addInput("xs", listIn("Known Xs"));
    this.addOutput("slope",     numOut("Slope"));
    this.addOutput("intercept", numOut("Intercept"));
    this.addOutput("r2",        numOut("R²"));
  }

  data(inputs: { ys?: (number | null | SolError)[][]; xs?: (number | null | SolError)[][] }): { slope: number | SolError | null; intercept: number | SolError | null; r2: number | SolError | null } {
    const { error, xs, ys } = forPair(inputs.xs?.[0] ?? null, inputs.ys?.[0] ?? null);
    if (error) {
      this.cachedSlope = this.cachedIntercept = this.cachedR2 = error;
      return { slope: error, intercept: error, r2: error };
    }
    let slope: number | null = null, intercept: number | null = null, r2: number | null = null;
    if (ys.length >= 2 && xs.length >= 2) {
      const n     = Math.min(ys.length, xs.length);
      const xMean = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
      const yMean = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
      let SSxy = 0, SSxx = 0, SSyy = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - xMean, dy = ys[i] - yMean;
        SSxy += dx * dy; SSxx += dx * dx; SSyy += dy * dy;
      }
      if (SSxx !== 0) {
        slope     = SSxy / SSxx;
        intercept = yMean - slope * xMean;
        r2        = (SSxx > 0 && SSyy > 0) ? (SSxy / Math.sqrt(SSxx * SSyy)) ** 2 : 0;
      }
    }
    this.cachedSlope     = slope;
    this.cachedIntercept = intercept;
    this.cachedR2        = r2;
    return { slope, intercept, r2 };
  }
}

// ─── LOGEST ───────────────────────────────────────────────────────────────────

export class LogestNode extends ClassicPreset.Node {
  label: string;
  cachedList: number[] | SolError = [];
  literals: Record<string, number> = {};
  width = 180; height = 185;

  constructor(init?: { label?: string }) {
    super("Logest");
    this.label = init?.label ?? "LOGEST";
    this.addInput("ys", listIn("Known Ys (> 0)"));
    this.addInput("xs", listIn("Known Xs"));
    this.addOutput("result", listOut("[m, b]  (y = b·mˣ)"));
  }

  data(inputs: { ys?: (number | null | SolError)[][]; xs?: (number | null | SolError)[][] }) {
    const { error, xs, ys } = forPair(inputs.xs?.[0] ?? null, inputs.ys?.[0] ?? null);
    if (error) { this.cachedList = error; return { result: error }; }
    let result: number[] = [];
    if (ys.length >= 2 && xs.length >= 2) {
      const n      = Math.min(ys.length, xs.length);
      const ySlice = ys.slice(0, n);
      const xSlice = xs.slice(0, n);
      if (ySlice.every(y => y > 0)) {
        const logYs  = ySlice.map(y => Math.log(y));
        const xMean  = xSlice.reduce((a, b) => a + b, 0) / n;
        const lyMean = logYs.reduce((a, b) => a + b, 0) / n;
        let SSxy = 0, SSxx = 0;
        for (let i = 0; i < n; i++) {
          SSxy += (xSlice[i] - xMean) * (logYs[i] - lyMean);
          SSxx += (xSlice[i] - xMean) ** 2;
        }
        if (SSxx !== 0) {
          const logM = SSxy / SSxx;
          result = [Math.exp(logM), Math.exp(lyMean - logM * xMean)];
        }
      }
    }
    this.cachedList = result;
    return { result };
  }
}

// ─── BINOM.DIST.RANGE ────────────────────────────────────────────────────────

export class BinomDistRangeNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { n: 10, p: 0.5, lo: 0, hi: 10 };
  width = 180; height = 240;

  constructor(init?: { label?: string }) {
    super("BinomDistRange");
    this.label = init?.label ?? "BINOM.DIST.RANGE";
    this.addInput("n",  numIn("n (trials)"));
    this.addInput("p",  numIn("p (probability)"));
    this.addInput("lo", numIn("lower bound"));
    this.addInput("hi", numIn("upper bound"));
    this.addOutput("result", numOut("P(lo ≤ X ≤ hi)"));
  }

  data(inputs: { n?: number[]; p?: number[]; lo?: number[]; hi?: number[] }) {
    const n  = Math.floor(inputs.n?.[0]  ?? this.literals.n  ?? 10);
    const p  = inputs.p?.[0]             ?? this.literals.p  ?? 0.5;
    const lo = Math.floor(inputs.lo?.[0] ?? this.literals.lo ?? 0);
    const hi = Math.floor(inputs.hi?.[0] ?? this.literals.hi ?? n);
    let result: number | null = null;
    if (n >= 0 && p >= 0 && p <= 1 && lo >= 0 && hi >= lo && hi <= n) {
      let sum = 0;
      for (let k = lo; k <= hi; k++) {
        const pmf = binomPmfLocal(k, n, p);
        if (pmf === null) { sum = NaN; break; }
        sum += pmf;
      }
      result = Number.isFinite(sum) ? Math.min(1, Math.max(0, sum)) : null;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── PROB ─────────────────────────────────────────────────────────────────────

export class ProbNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { lo: 0, hi: 1 };
  width = 180; height = 250;

  constructor(init?: { label?: string }) {
    super("Prob");
    this.label = init?.label ?? "PROB";
    this.addInput("range", listIn("Range"));
    this.addInput("probs", listIn("Probabilities"));
    this.addInput("lo",    numIn("Lower limit"));
    this.addInput("hi",    numIn("Upper limit"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { range?: number[][]; probs?: number[][]; lo?: number[]; hi?: number[] }) {
    const range = inputs.range?.[0] ?? null;
    const probs = inputs.probs?.[0] ?? null;
    const lo    = inputs.lo?.[0]    ?? this.literals.lo ?? 0;
    const hi    = inputs.hi?.[0]    ?? this.literals.hi ?? 1;
    let result: number | null = null;
    if (range && probs && range.length > 0 && probs.length >= range.length) {
      const n = range.length;
      let prob = 0;
      for (let i = 0; i < n; i++) {
        if (range[i] >= lo && range[i] <= hi) prob += probs[i];
      }
      result = Number.isFinite(prob) ? Math.min(1, Math.max(0, prob)) : null;
    }
    this.cachedResult = result;
    return { result };
  }
}

