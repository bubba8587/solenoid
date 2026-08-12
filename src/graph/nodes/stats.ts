import { ClassicPreset } from "rete";
import { broadcastErr, listIn, listOut, numIn, numOut, numListIn, numListOut, readInput, tableIn, tableOut } from "./shared";
import { fillBorderedGrid } from "./mathUtils";
import { normSInv, regularizedGamma, stdNormCDF, lnCombin, bisectionInv, iterMax, linearFit, linearFitR2, expFit, interpolateLinear, arrMean, arrSampleVar, tCDF, pairPresent, tTestP, fTestP, probBetween } from "./mathUtils";
import { solError, isSolError, type SolError } from "../errorValue";
import { excelRank, excelTrimmean, excelPercentRank } from "../excelFunctions";
import { forAggregate } from "../valueKinds";
import { carryMatrixUnit } from "../unitValue";


// The pairwise cell policy, shared with the formula surface (mathUtils.pairPresent):
// first cell error propagates, a pair with a missing side drops, ragged tails truncate.
const forPair = pairPresent;

// ─── Statistics nodes ─────────────────────────────────────────────────────────

// ─── Order statistics — ONE node (LARGE/SMALL, RANK, PERCENTILE/QUARTILE/
// PERCENTRANK) ────────────────────────────────────────────────────────────────
// Every op reads a list plus one position-or-value scalar and answers a single
// number; only the scalar's meaning varies (k / value / p / q). PERCENTILE and
// PERCENTRANK are each other's inverse (value at a rank / rank of a value).

export type RankPercentileOp =
  | "large" | "small"
  | "rank-eq" | "rank-avg"
  | "percentile-inc" | "percentile-exc"
  | "quartile-inc" | "quartile-exc"
  | "percentrank-inc" | "percentrank-exc";

export const RANK_PERCENTILE_OP_META = {
  large:             { label: "LARGE",           description: "Kth largest value. Excel: LARGE." },
  small:             { label: "SMALL",           description: "Kth smallest value. Excel: SMALL." },
  "rank-eq":         { label: "RANK.EQ",         description: "Rank; ties share the lowest rank. Excel: RANK.EQ." },
  "rank-avg":        { label: "RANK.AVG",        description: "Rank; ties share the average rank. Excel: RANK.AVG." },
  "percentile-inc":  { label: "PERCENTILE.INC",  description: "Value at percentile p (0–1), including the endpoints. Excel: PERCENTILE.INC." },
  "percentile-exc":  { label: "PERCENTILE.EXC",  description: "Value at percentile p, excluding 0 and 1. Excel: PERCENTILE.EXC." },
  "quartile-inc":    { label: "QUARTILE.INC",    description: "Quartile Q0–Q4, including the endpoints. Excel: QUARTILE.INC." },
  "quartile-exc":    { label: "QUARTILE.EXC",    description: "Quartile Q1–Q3, excluding the endpoints. Excel: QUARTILE.EXC." },
  "percentrank-inc": { label: "PERCENTRANK.INC", description: "Percentile rank of a value (0–1), including the endpoints. Excel: PERCENTRANK.INC." },
  "percentrank-exc": { label: "PERCENTRANK.EXC", description: "Percentile rank of a value, excluding 0 and 1. Excel: PERCENTRANK.EXC." },
} satisfies Record<RankPercentileOp, { label: string; description: string }>;

type RankPercentileFamily = "nth" | "rank" | "percentile" | "quartile" | "percentrank";

const RANK_PERCENTILE_FAMILY: Record<RankPercentileOp, RankPercentileFamily> = {
  large: "nth", small: "nth",
  "rank-eq": "rank", "rank-avg": "rank",
  "percentile-inc": "percentile", "percentile-exc": "percentile",
  "quartile-inc": "quartile", "quartile-exc": "quartile",
  "percentrank-inc": "percentrank", "percentrank-exc": "percentrank",
};

const RANK_PERCENTILE_SPECS: Record<RankPercentileFamily, {
  inputs: ReadonlyArray<{ key: string; label: string; def: number }>;
  outLabel: string;
  height: number;
}> = {
  nth:         { inputs: [{ key: "k", label: "K", def: 1 }],                                                    outLabel: "Value",      height: 170 },
  rank:        { inputs: [{ key: "value", label: "Value", def: 0 }],                                            outLabel: "Rank",       height: 185 },
  percentile:  { inputs: [{ key: "p", label: "Percentile (0–1)", def: 0.5 }],                                   outLabel: "Value",      height: 185 },
  quartile:    { inputs: [{ key: "q", label: "Quartile (0–4)", def: 2 }],                                       outLabel: "Value",      height: 185 },
  percentrank: { inputs: [{ key: "value", label: "Value", def: 0 }, { key: "significance", label: "Digits", def: 3 }], outLabel: "Rank (0–1)", height: 210 },
};

/** The shared interpolating percentile kernel; `exc` uses Excel's exclusive rank. */
function percentileOf(sorted: number[], p: number, exc: boolean): number {
  const n = sorted.length;
  const i = exc ? p * (n + 1) - 1 : p * (n - 1);
  const lo = Math.floor(i), hi = exc ? Math.min(n - 1, Math.ceil(i)) : Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export class RankPercentileNode extends ClassicPreset.Node {
  label: string;
  op: RankPercentileOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = {};
  width = 180;
  height = 185;

  constructor(init?: { label?: string; op?: RankPercentileOp }) {
    super("RankPercentile");
    this.label = init?.label ?? "Rank & Percentile";
    this.op = init?.op ?? "large";
    this.addInput("list", listIn("List"));
    for (const i of RANK_PERCENTILE_SPECS[this.family].inputs) this.addInput(i.key, numIn(i.label));
    this.addOutput("result", numOut(RANK_PERCENTILE_SPECS[this.family].outLabel));
    this.seedLiterals();
    this.height = RANK_PERCENTILE_SPECS[this.family].height;
  }

  get family(): RankPercentileFamily { return RANK_PERCENTILE_FAMILY[this.op]; }

  private seedLiterals(): void {
    for (const i of RANK_PERCENTILE_SPECS[this.family].inputs) this.literals[i.key] ??= i.def;
  }

  /** The keys a switch to `next` would remove. Callers on a live graph prune
   *  these BEFORE calling setOp (SSOT-9). */
  keysDroppedBySwitch(next: RankPercentileOp): string[] {
    const keep = new Set(RANK_PERCENTILE_SPECS[RANK_PERCENTILE_FAMILY[next]].inputs.map((i) => i.key));
    return RANK_PERCENTILE_SPECS[this.family].inputs.filter((i) => !keep.has(i.key)).map((i) => i.key);
  }

  setOp(next: RankPercentileOp): void {
    if (next === this.op) return;
    const before = RANK_PERCENTILE_SPECS[this.family].inputs;
    this.op = next;
    const spec = RANK_PERCENTILE_SPECS[this.family];
    for (const i of before) if (!spec.inputs.some((j) => j.key === i.key)) this.removeInput(i.key);
    for (const i of spec.inputs) if (!this.inputs[i.key]) this.addInput(i.key, numIn(i.label));
    const out = this.outputs.result;
    if (out) out.label = spec.outLabel;
    this.seedLiterals();
    this.height = spec.height;
  }

  data(inputs: { list?: (number | null | SolError)[][]; k?: number[]; value?: number[]; p?: number[]; q?: number[]; significance?: number[] }): { result: number | SolError | null } {
    const family = this.family;
    const exc = this.op.endsWith("-exc");

    if (family === "rank" || family === "percentrank") {
      // The raw list: excelRank / excelPercentRank own their null handling
      // (shared with the formula surface — one impl both call).
      const arr = inputs.list?.[0] ?? null;
      const v = readInput(inputs.value, this.literals.value ?? null);
      if (family === "percentrank") {
        const sigRaw = readInput(inputs.significance, this.literals.significance ?? 3);
        if (sigRaw === null) { this.cachedResult = null; return { result: null }; }
        if (!arr || arr.length === 0 || v === null) { this.cachedResult = null; return { result: null }; }
        const result = excelPercentRank(arr as number[], v, Math.round(sigRaw), exc);
        this.cachedResult = result;
        return { result };
      }
      if (!arr || arr.length === 0 || v === null) { this.cachedResult = null; return { result: null }; }
      const result = excelRank(v, arr as number[], this.op === "rank-avg");
      this.cachedResult = result;
      return { result };
    }

    // SolError propagates; null (missing) is skipped before ranking.
    const prep = forAggregate(inputs.list?.[0] ?? []);
    if (prep.error) { this.cachedResult = prep.error; return { result: prep.error }; }
    const arr = prep.nums;
    let result: number | SolError | null = null;

    if (family === "nth") {
      const kRaw = readInput(inputs.k, this.literals.k ?? 1);
      if (kRaw === null) { this.cachedResult = null; return { result: null }; }
      const k = Math.round(kRaw);
      if (arr.length > 0 && k >= 1 && k <= arr.length) {
        const sorted = [...arr].sort((a, b) => a - b);
        result = this.op === "large" ? sorted[arr.length - k] : sorted[k - 1];
      }
    } else if (family === "percentile") {
      const p = readInput(inputs.p, this.literals.p ?? 0.5);
      if (p === null) { this.cachedResult = null; return { result: null }; }
      if (arr.length > 0) {
        const n = arr.length;
        if (!exc && (p < 0 || p > 1)) {
          result = solError("#DOMAIN!", "Percentile must be between 0 and 1");
        } else if (exc && (p < 1 / (n + 1) || p > n / (n + 1))) {
          // Excel PERCENTILE.EXC: p must lie strictly inside (1/(n+1), n/(n+1)) —
          // outside it Excel returns #NUM!.
          result = solError("#DOMAIN!", "Percentile is outside the EXC domain: it must lie strictly between 1/(n+1) and n/(n+1)");
        } else {
          result = percentileOf([...arr].sort((a, b) => a - b), p, exc);
        }
      }
    } else {
      const qRaw = readInput(inputs.q, this.literals.q ?? 2);
      if (qRaw === null) { this.cachedResult = null; return { result: null }; }
      const q = Math.round(qRaw);
      if (arr.length > 0 && q >= 0 && q <= 4) {
        const n = arr.length;
        const p = q / 4;
        if (exc && (q === 0 || q === 4)) {
          result = solError("#DOMAIN!", "QUARTILE.EXC is undefined for quartile 0 or 4");
        } else if (exc && (p < 1 / (n + 1) || p > n / (n + 1))) {
          // QUARTILE.EXC(q) is PERCENTILE.EXC(q/4): an interior q can still fall
          // outside the EXC domain at small n.
          result = solError("#DOMAIN!", "Quartile is outside the EXC domain: q/4 must lie between 1/(n+1) and n/(n+1)");
        } else {
          result = percentileOf([...arr].sort((a, b) => a - b), p, exc);
        }
      }
    }
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
    const v = readInput(inputs.value, this.literals.value ?? null);
    const m = readInput(inputs.mean, this.literals.mean ?? null);
    const s = readInput(inputs.stdev, this.literals.stdev ?? null);
    // #DIV/0! is tagged at every dimensionality — a per-element zero sigma in a LIST
    // becomes a per-cell error, not a whole-list one.
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
  pop:  { label: "COVARIANCE.P", description: "Population covariance: how two lists move together; divides by n. For when you have every data point. Excel: COVARIANCE.P." },
  samp: { label: "COVARIANCE.S", description: "Sample covariance: how two lists move together; divides by n−1. For a sample of a bigger population. Excel: COVARIANCE.S." },
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
    const v = readInput(inputs.value, this.literals.value ?? null);
    // Defined only on (−1, 1); #DOMAIN! is tagged per-cell in a LIST, not whole-list.
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
        // The (n−2) denominator needs 3+ points; fewer is a blank, not an error.
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
    const x = readInput(inputs.x, this.literals.x ?? 0);
    if (x === null) { this.cachedResult = null; return { result: null }; }
    const { error, xs: xsP, ys: ysP } = forPair(inputs.xs?.[0] ?? null, inputs.ys?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    const ys = ysP, xs = xsP;
    let result: number | null = null;
    if (ys.length >= 2 && xs.length >= 2) {
      const fit = linearFit(xs, ys);
      // Zero X variance — the linear fit divides by SSxx and is undefined.
      if (!fit) {
        const err = solError("#DIV/0!", "Known Xs have zero variance");
        this.cachedResult = err;
        return { result: err };
      }
      result = fit.intercept + fit.slope * x;
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
    // Combo output: one mode → scalar, a tie → the full list, so no arbitrary tie-break
    // is needed (this supersedes Excel's MODE.SNGL/MODE.MULT split).
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
    const percent = readInput(inputs.percent, this.literals.percent ?? 0.1);
    if (percent === null) { this.cachedResult = null; return { result: null }; }
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
    const alpha = readInput(inputs.alpha, this.literals.alpha ?? 0.05);
    const stdev = readInput(inputs.stdev, this.literals.stdev ?? 1);
    const nRaw  = readInput(inputs.n,     this.literals.n     ?? 30);
    if (alpha === null || stdev === null || nRaw === null) { this.cachedResult = null; return { result: null }; }
    const n = Math.round(nRaw);
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

function binomPmfLocal(k: number, n: number, p: number): number | null {
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  const r = Math.exp(lnCombin(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  return Number.isFinite(r) ? r : null;
}

// ─── Hypothesis tests — ONE node (Z / t / F / chi-square) ────────────────────
// Every test emits a p-value; the op selector swaps the input rows (Z: one
// sample + μ₀ + optional σ; t/F: two samples; chi-square: observed/expected).
// The sample keys are shared (`a`/`b`) so a switch between two-sample tests
// keeps the cables and only the row labels change.

export type HypothesisTestOp = "z" | "t-paired" | "t-equal" | "t-welch" | "f" | "chisq";

export const HYPOTHESIS_TEST_OP_META = {
  z:          { label: "Z.TEST",             description: "One-tailed z-test: P(mean > μ₀) given a population or sample. Excel: Z.TEST." },
  "t-paired": { label: "T.TEST (paired)",    description: "Paired t-test: the same subjects measured twice, 2-tailed. Excel: T.TEST type 1." },
  "t-equal":  { label: "T.TEST (equal var)", description: "Two-sample t-test with pooled variance, 2-tailed. Excel: T.TEST type 2." },
  "t-welch":  { label: "T.TEST (Welch)",     description: "Two-sample t-test assuming unequal variances: Welch's t-test, 2-tailed. Excel: T.TEST type 3." },
  f:          { label: "F.TEST",             description: "Two-tailed F-test for equal variances. Excel: F.TEST." },
  chisq:      { label: "CHISQ.TEST",         description: "Chi-square goodness-of-fit test (observed vs. expected). Excel: CHISQ.TEST." },
} satisfies Record<HypothesisTestOp, { label: string; description: string }>;

interface HypothesisTestSpec {
  inputs: ReadonlyArray<{ key: string; label: string; num?: boolean }>;
  outLabel: string;
}

const TWO_SAMPLE_SPEC: HypothesisTestSpec = {
  inputs: [{ key: "a", label: "Array 1" }, { key: "b", label: "Array 2" }],
  outLabel: "p-value (2-tail)",
};

export const HYPOTHESIS_TEST_SPECS: Record<HypothesisTestOp, HypothesisTestSpec> = {
  z: {
    inputs: [
      { key: "a", label: "Array" },
      { key: "x", label: "μ₀", num: true },
      { key: "sigma", label: "σ (optional)", num: true },
    ],
    outLabel: "p-value (upper)",
  },
  "t-paired": TWO_SAMPLE_SPEC,
  "t-equal": TWO_SAMPLE_SPEC,
  "t-welch": TWO_SAMPLE_SPEC,
  f: TWO_SAMPLE_SPEC,
  chisq: {
    inputs: [{ key: "a", label: "Observed" }, { key: "b", label: "Expected" }],
    outLabel: "p-value",
  },
};

const T_KERNEL_OP = { "t-paired": "paired", "t-equal": "equal-var", "t-welch": "unequal-var" } as const;

export class HypothesisTestNode extends ClassicPreset.Node {
  label: string;
  op: HypothesisTestOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = {};
  width = 180;
  height = 210;

  constructor(init?: { label?: string; op?: HypothesisTestOp }) {
    super("HypothesisTest");
    this.label = init?.label ?? "Hypothesis Test";
    this.op = init?.op ?? "z";
    for (const i of HYPOTHESIS_TEST_SPECS[this.op].inputs) {
      this.addInput(i.key, i.num ? numIn(i.label) : listIn(i.label));
    }
    this.addOutput("result", numOut(HYPOTHESIS_TEST_SPECS[this.op].outLabel));
    this.seedLiterals();
    this.height = this.heightFor();
  }

  private heightFor(): number {
    return 210 + 28 * (HYPOTHESIS_TEST_SPECS[this.op].inputs.length - 2);
  }

  private seedLiterals(): void {
    if (this.op === "z") this.literals.x ??= 0;
  }

  /** The keys a switch to `next` would remove. Callers on a live graph prune
   *  these BEFORE calling setOp (SSOT-9). */
  keysDroppedBySwitch(next: HypothesisTestOp): string[] {
    const keep = new Set(HYPOTHESIS_TEST_SPECS[next].inputs.map((i) => i.key));
    return HYPOTHESIS_TEST_SPECS[this.op].inputs.filter((i) => !keep.has(i.key)).map((i) => i.key);
  }

  setOp(next: HypothesisTestOp): void {
    if (next === this.op) return;
    const before = HYPOTHESIS_TEST_SPECS[this.op].inputs;
    const after = HYPOTHESIS_TEST_SPECS[next].inputs;
    this.op = next;
    for (const i of before) if (!after.some((j) => j.key === i.key)) this.removeInput(i.key);
    for (const i of after) {
      const live = this.inputs[i.key];
      if (!live) this.addInput(i.key, i.num ? numIn(i.label) : listIn(i.label));
      else live.label = i.label; // a kept key keeps its cable; the role name follows the op
    }
    const out = this.outputs.result;
    if (out) out.label = HYPOTHESIS_TEST_SPECS[next].outLabel;
    this.seedLiterals();
    this.height = this.heightFor();
  }

  data(inputs: { a?: number[][]; b?: number[][]; x?: number[]; sigma?: number[] }) {
    const a = inputs.a?.[0] ?? null;
    let result: number | null = null;
    if (this.op === "z") {
      const x = readInput(inputs.x, this.literals.x ?? 0); // wired blank → null → blank result
      // σ: UNWIRED is Excel's omitted argument (use the sample std); a WIRED blank is
      // unknown and propagates (value-semantics.md, "Reading an input").
      const sigma = inputs.sigma === undefined ? undefined : (inputs.sigma[0] ?? null);
      if (a && a.length >= 2 && x !== null && sigma !== null) {
        const n = a.length;
        const m = arrMean(a);
        const std = (sigma !== undefined && sigma > 0) ? sigma : Math.sqrt(arrSampleVar(a));
        if (std > 0) result = 1 - stdNormCDF((m - x) / (std / Math.sqrt(n)));
      }
    } else if (this.op === "chisq") {
      const exp = inputs.b?.[0] ?? null;
      if (a && exp && a.length >= 2 && exp.length >= a.length) {
        const n = a.length;
        let chi2 = 0;
        for (let i = 0; i < n; i++) {
          if (exp[i] <= 0) { chi2 = NaN; break; }
          chi2 += (a[i] - exp[i]) ** 2 / exp[i];
        }
        if (Number.isFinite(chi2) && chi2 >= 0) {
          result = 1 - regularizedGamma((n - 1) / 2, chi2 / 2);
          if (!Number.isFinite(result)) result = null;
        }
      }
    } else {
      // ONE implementation with the formula surface (mathUtils.tTestP / fTestP — FX-1).
      const b = inputs.b?.[0] ?? null;
      if (a && b) result = this.op === "f" ? fTestP(a, b) : tTestP(T_KERNEL_OP[this.op], a, b);
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
    // Shared fitting kernel (mathUtils) — the TREND registration runs the same one.
    const fit = newXs.length > 0 ? linearFit(xs, ys) : null;
    const result: number[] = fit ? newXs.map((x) => fit.intercept + fit.slope * x) : [];
    this.cachedList = result;
    return { result };
  }
}

// ─── Interpolate (List = 1-D, Grid = fill a bordered 2-D table) ──────────────────
// Two modes; the dropdown swaps the whole socket set:
//  • LIST — interpolate y for a query x between known (x, y) points.
//  • GRID — fill the blanks of a coordinate-BORDERED table (row 1 = X coords,
//    column 1 = Y coords, top-left ignored on input and blanked on output).
// Both CLAMP at the ends (no extrapolation past the known range).

export type InterpolateMode = "list" | "grid";

export const INTERPOLATE_MODE_META: Record<InterpolateMode, { label: string; title: string }> = {
  list: { label: "List", title: "1-D: interpolate y for a query x between known (x, y) points" },
  grid: { label: "Grid", title: "Fill the blanks in a bordered table (row 1 = Xs, column 1 = Ys) by 2-D interpolation" },
};

// The interpolation bracket for a query against a SORTED-ASCENDING axis: [i0, i1, t]
// with value = (1-t)·v[i0] + t·v[i1], clamped at both ends (t=0 outside the range).


export class InterpolateNode extends ClassicPreset.Node {
  label: string;
  mode: InterpolateMode;
  // LIST mode: scalar-or-list matching the query shape. GRID mode: the filled bordered
  // table (cells may be null where nothing reached). A whole-input error → SolError.
  cachedResult: number | (number | null)[] | (number | null)[][] | SolError | null = null;
  literals: Record<string, number> = { x: 0 };
  // GRID mode: also linearly EXTRAPOLATE beyond the known data (the Forecast checkbox),
  // not just interpolate the interior. On by default.
  forecast = true;
  width = 180; height = 215;

  constructor(init?: { label?: string; mode?: InterpolateMode; forecast?: boolean }) {
    super("Interpolate");
    this.label = init?.label ?? "INTERPOLATE";
    this.mode = init?.mode ?? "list";
    if (init?.forecast != null) this.forecast = init.forecast;
    this._rebuildSockets();
  }

  // Callers must drop this node's cables first (applyInterpolateMode) — removeInput is
  // unsafe while a cable still references the socket.
  _rebuildSockets(): void {
    for (const key of Object.keys(this.inputs)) this.removeInput(key);
    for (const key of Object.keys(this.outputs)) this.removeOutput(key);
    if (this.mode === "grid") {
      this.addInput("grid", tableIn("Bordered grid"));
      this.addOutput("result", tableOut("Filled grid"));
      this.height = 215;
      return;
    }
    this.addInput("ys",     listIn("Known Ys"));
    this.addInput("xs",     listIn("Known Xs"));
    // Combo query: the result mirrors the query's shape, scalar in → scalar out.
    this.addInput("new_xs", numListIn("X"));
    this.addOutput("result", numListOut("Interpolated Y"));
    this.height = 215;
  }

  data(inputs: Record<string, unknown[]>): { result: number | (number | null)[] | (number | null)[][] | SolError | null } {
    return this.mode === "grid" ? this.dataGrid(inputs) : this.dataList(inputs);
  }

  private dataList(inputs: Record<string, unknown[]>): { result: number | (number | null)[] | SolError | null } {
    const xsIn = inputs.xs as (number | null | SolError)[][] | undefined;
    const ysIn = inputs.ys as (number | null | SolError)[][] | undefined;
    // Known data: propagate the first error, drop pairs missing on either side.
    const { error, xs, ys } = forPair(xsIn?.[0] ?? null, ysIn?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
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

  private dataGrid(inputs: Record<string, unknown[]>): { result: (number | null)[][] | SolError | null } {
    const gridRaw = inputs.grid?.[0] ?? null;
    if (isSolError(gridRaw)) { this.cachedResult = gridRaw; return { result: gridRaw }; }
    if (!Array.isArray(gridRaw)) { this.cachedResult = null; return { result: null }; }
    // Coerce cells to number|null: a per-cell error or a non-finite cell reads as BLANK
    // (a hole to fill), so a stray dirty cell doesn't poison the interpolation.
    const grid: (number | null)[][] = gridRaw.map((row) =>
      (Array.isArray(row) ? row : []).map((c) => (typeof c === "number" && Number.isFinite(c) ? c : null)),
    );
    // Carry the D20 grid unit: filling blanks keeps every cell in the input's unit
    // (structural reshape, matrixUnitPolicy "carry").
    const result = carryMatrixUnit(fillBorderedGrid(grid, this.forecast), gridRaw);
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
    // Shared fitting kernel (mathUtils) — the LINEST registration runs the same one.
    const fit = linearFitR2(xs, ys);
    this.cachedSlope     = fit?.slope ?? null;
    this.cachedIntercept = fit?.intercept ?? null;
    this.cachedR2        = fit?.r2 ?? null;
    return { slope: this.cachedSlope, intercept: this.cachedIntercept, r2: this.cachedR2 };
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
    // ONE implementation with the LOGEST/GROWTH registrations; a degenerate fit stays
    // the quiet empty list.
    const fit = expFit(xs, ys);
    const result: number[] = fit ? [fit.m, fit.b] : [];
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
    const nRaw  = readInput(inputs.n,  this.literals.n  ?? 10);
    const p     = readInput(inputs.p,  this.literals.p  ?? 0.5);
    if (nRaw === null || p === null) { this.cachedResult = null; return { result: null }; }
    const n = Math.floor(nRaw);
    const loRaw = readInput(inputs.lo, this.literals.lo ?? 0);
    const hiRaw = readInput(inputs.hi, this.literals.hi ?? n);
    if (loRaw === null || hiRaw === null) { this.cachedResult = null; return { result: null }; }
    const lo = Math.floor(loRaw);
    const hi = Math.floor(hiRaw);
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
  cachedResult: number | SolError | null = null;
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
    const lo    = readInput(inputs.lo, this.literals.lo ?? 0);
    const hi    = readInput(inputs.hi, this.literals.hi ?? 1);
    if (lo === null || hi === null) { this.cachedResult = null; return { result: null }; }
    // ONE implementation with the formula surface (mathUtils.probBetween — FX-1).
    const result = probBetween(range, probs, lo, hi);
    this.cachedResult = result;
    return { result };
  }
}

