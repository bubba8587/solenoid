import { ClassicPreset } from "rete";
import { broadcastErr, listIn, listOut, numIn, numOut, numListIn, numListOut, readInput, tableIn, tableOut, frameOut, strOut } from "./shared";
import { rk4 } from "./odeOps";
import { resolveFn } from "./tableLambda";
import { lambdaIn } from "./shared";
import { gridAxes, fillGrid } from "./mathUtils";
import { normSInv, regularizedGamma, stdNormCDF, lnCombin, bisectionInv, linearFit, linearFitR2, expFit, interpolateLinear, arrMean, arrSampleVar, tCDF, pairPresent, tTestP, fTestP, probBetween } from "./mathUtils";
import { solError, isSolError, type SolError } from "../errorValue";
import { excelRank, excelTrimmean, excelPercentRank } from "../excelFunctions";
import { fitEts, etsForecast, etsInterval, detectSeason, seasonalDecompose, stlDecompose, type DecomposeModel } from "./forecastOps";
export type { DecomposeModel } from "./forecastOps";
import { fitAll, FIT_FAMILIES, type DistFit, type FitFamily } from "./fitOps";
import type { FrameValue } from "../frame";
import { percentile, quartile, nthExtreme, pearson, spearman, kendallTau, covariance, modes, fisher, regression, anovaP, mannWhitneyP, wilcoxonSignedRankP, kruskalP, fisherExactP, ksTwoSampleP, twoProportionP, binomTestP } from "./statsOps";
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
  "rank-eq":         { label: "RANK.EQ",         description: "Rank. Ties share the lowest rank. Excel: RANK.EQ." },
  "rank-avg":        { label: "RANK.AVG",        description: "Rank. Ties share the average rank. Excel: RANK.AVG." },
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

export class RankPercentileNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    significance: "The rank truncates to this many digits. It does not round.",
  };

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
   *  these BEFORE calling setOp (onePrunePath). */
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

    // The shared statsOps kernels — the LARGE/SMALL/PERCENTILE.*/QUARTILE.* formulas run
    // the same ones, so the two surfaces can't drift.
    if (family === "nth") {
      const kRaw = readInput(inputs.k, this.literals.k ?? 1);
      if (kRaw === null) { this.cachedResult = null; return { result: null }; }
      result = nthExtreme(arr, kRaw, this.op === "large");
    } else if (family === "percentile") {
      const p = readInput(inputs.p, this.literals.p ?? 0.5);
      if (p === null) { this.cachedResult = null; return { result: null }; }
      result = percentile(arr, p, exc);
    } else {
      const qRaw = readInput(inputs.q, this.literals.q ?? 2);
      if (qRaw === null) { this.cachedResult = null; return { result: null }; }
      // An out-of-range INC quartile is a blank on the node (a mis-set dial), the
      // formula's #DOMAIN! — the one deliberate surface difference, kept from before.
      result = !exc && (Math.round(qRaw) < 0 || Math.round(qRaw) > 4) ? null : quartile(arr, qRaw, exc);
    }
    this.cachedResult = result;
    return { result };
  }
}

export type CorrelOp = "correl" | "rsq" | "spearman" | "kendall";

export const CORREL_OP_META = {
  correl: { label: "CORREL", description: "Pearson correlation r between two lists. Excel: CORREL." },
  rsq:    { label: "RSQ",    description: "R², the square of the correlation coefficient. Excel: RSQ." },
  spearman: { label: "SPEARMAN", description: "Spearman's rank correlation ρ: Pearson over the ranks, so it follows any monotone relation and shrugs off outliers. scipy spearmanr, R cor(method=\"spearman\")." },
  kendall:  { label: "KENDALL",  description: "Kendall's τ-b: concordant minus discordant pairs, tie-corrected. scipy kendalltau, R cor(method=\"kendall\")." },
} satisfies Record<CorrelOp, { label: string; description: string }>;

export class CorrelNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    x: "Pairs with Y by position. A pair with a blank on either side is dropped, and an unmatched tail is ignored.",
  };

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
    // Shared with the CORREL / RSQ / SPEARMAN / KENDALL formulas.
    const result = this.op === "spearman" ? spearman(xs, ys)
      : this.op === "kendall" ? kendallTau(xs, ys)
      : pearson(xs, ys, this.op === "rsq");
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
  pop:  { label: "COVARIANCE.P", description: "Population covariance: how two lists move together. Divides by n. For when you have every data point. Excel: COVARIANCE.P." },
  samp: { label: "COVARIANCE.S", description: "Sample covariance: how two lists move together. Divides by n−1. For a sample of a bigger population. Excel: COVARIANCE.S." },
} satisfies Record<CovarianceOp, { label: string; description: string }>;

export class CovarianceNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    x: "Pairs with Y by position. A pair with a blank on either side is dropped, and an unmatched tail is ignored.",
  };

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
    const result = covariance(xs, ys, this.op !== "pop"); // shared with the COVARIANCE.P/.S formulas
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
    let result: number | (number | SolError | null)[] | SolError | null = null;
    if (v !== null) result = broadcastErr((x) => fisher(x, this.op === "fisherinv"), v);
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
  static socketDocs: Record<string, string> = {
    ys: "Pairs with Known Xs by position. A pair with a blank on either side is dropped, and an unmatched tail is ignored.",
  };

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
    const { error, xs, ys } = forPair(inputs.xs?.[0] ?? null, inputs.ys?.[0] ?? null);
    if (error) { this.cachedResult = error; return { result: error }; }
    const result = regression(xs, ys, this.op); // shared with the SLOPE / INTERCEPT / STEYX formulas
    this.cachedResult = result;
    return { result };
  }
}

// ─── Forecast ─────────────────────────────────────────────────────────────────

export class ForecastNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    ys: "Pairs with Known Xs by position. A pair with a blank on either side is dropped, and an unmatched tail is ignored.",
  };

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
  static socketDocs: Record<string, string> = {
    result: "One mode arrives as a number. Tied modes arrive together as a sorted list.",
  };

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
    const result = modes(prep.nums); // shared with the MODE / MODE.SNGL formulas
    this.cachedResult = result;
    return { result };
  }
}

// ─── TrimMean ─────────────────────────────────────────────────────────────────

export class TrimMeanNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    percent: "A fraction from 0 to 1, not a whole-number percent. Half of the trimmed count comes off each end.",
  };

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
  static socketDocs: Record<string, string> = {
    bins: "Bins sort ascending before counting, and each holds values up to and including its bound.",
    result: "One count per bin plus a final count of everything above the last bin.",
  };

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

export type HypothesisTestOp =
  | "z" | "t-paired" | "t-equal" | "t-welch" | "f" | "chisq"
  | "anova" | "mannwhitney" | "wilcoxon" | "kruskal" | "fisher" | "ks" | "proptest" | "binomtest";

export const HYPOTHESIS_TEST_OP_META = {
  z:          { label: "Z.TEST",             description: "One-tailed z-test: P(mean > μ₀) given a population or sample. Excel: Z.TEST." },
  "t-paired": { label: "T.TEST (paired)",    description: "Paired t-test: the same subjects measured twice, 2-tailed. Excel: T.TEST type 1." },
  "t-equal":  { label: "T.TEST (equal var)", description: "Two-sample t-test with pooled variance, 2-tailed. Excel: T.TEST type 2." },
  "t-welch":  { label: "T.TEST (Welch)",     description: "Two-sample t-test assuming unequal variances: Welch's t-test, 2-tailed. Excel: T.TEST type 3." },
  f:          { label: "F.TEST",             description: "Two-tailed F-test for equal variances. Excel: F.TEST." },
  chisq:      { label: "CHISQ.TEST",         description: "Chi-square goodness-of-fit test (observed vs. expected). Excel: CHISQ.TEST." },
  anova:      { label: "ANOVA",              description: "One-way ANOVA: do k groups share a mean? Each table column is a group (blanks skipped); the upper-tail F p-value. scipy f_oneway, R aov. No Excel function (the Data Analysis add-in only)." },
  mannwhitney:{ label: "Mann–Whitney U",     description: "Rank-sum test for two independent samples, two-sided (the nonparametric t-test). Normal approximation with tie and continuity corrections — R wilcox.test, scipy mannwhitneyu." },
  wilcoxon:   { label: "Wilcoxon signed-rank", description: "Paired nonparametric test: ranks of the paired differences, zeros dropped, two-sided with continuity correction — R wilcox.test(paired=TRUE)." },
  kruskal:    { label: "Kruskal–Wallis",     description: "Nonparametric one-way ANOVA over k groups (table columns), tie-corrected H against χ². scipy kruskal, R kruskal.test." },
  fisher:     { label: "Fisher exact",       description: "Fisher's exact test on a 2×2 table of counts, two-sided — the small-sample answer where CHISQ.TEST is unreliable. R fisher.test, scipy fisher_exact." },
  ks:         { label: "KS (2-sample)",      description: "Two-sample Kolmogorov–Smirnov: are two samples from the same distribution? Asymptotic two-sided p. scipy ks_2samp, R ks.test." },
  proptest:   { label: "Two-proportion z",   description: "Are two success rates different? x₁ of n₁ vs x₂ of n₂, pooled z, two-sided, no continuity correction (statsmodels proportions_ztest; R prop.test(correct=FALSE))." },
  binomtest:  { label: "Binomial test",      description: "Exact test of k successes in n against a hypothesised rate p₀, two-sided. scipy binomtest, R binom.test." },
} satisfies Record<HypothesisTestOp, { label: string; description: string }>;

interface HypothesisTestSpec {
  /** `num` → a scalar number socket, `table` → a matrix (each column a group), else a list. */
  inputs: ReadonlyArray<{ key: string; label: string; num?: boolean; table?: boolean }>;
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
  anova:   { inputs: [{ key: "groups", label: "Groups (columns)", table: true }], outLabel: "p-value (F)" },
  kruskal: { inputs: [{ key: "groups", label: "Groups (columns)", table: true }], outLabel: "p-value (H)" },
  mannwhitney: { inputs: [{ key: "a", label: "Sample 1" }, { key: "b", label: "Sample 2" }], outLabel: "p-value (2-tail)" },
  wilcoxon:    { inputs: [{ key: "a", label: "Before" }, { key: "b", label: "After" }], outLabel: "p-value (2-tail)" },
  ks:          { inputs: [{ key: "a", label: "Sample 1" }, { key: "b", label: "Sample 2" }], outLabel: "p-value (2-tail)" },
  fisher:   { inputs: [{ key: "table", label: "2×2 counts", table: true }], outLabel: "p-value (2-tail)" },
  proptest: {
    inputs: [
      { key: "x1", label: "Successes 1", num: true }, { key: "n1", label: "Trials 1", num: true },
      { key: "x2", label: "Successes 2", num: true }, { key: "n2", label: "Trials 2", num: true },
    ],
    outLabel: "p-value (2-tail)",
  },
  binomtest: {
    inputs: [
      { key: "k", label: "Successes", num: true }, { key: "n", label: "Trials", num: true },
      { key: "p0", label: "p₀", num: true },
    ],
    outLabel: "p-value (2-tail)",
  },
};

const T_KERNEL_OP = { "t-paired": "paired", "t-equal": "equal-var", "t-welch": "unequal-var" } as const;

export class HypothesisTestNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    sigma: "Left unwired, the sample's own standard deviation is used. A wired blank instead blanks the result.",
  };

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
      this.addInput(i.key, i.num ? numIn(i.label) : i.table ? tableIn(i.label) : listIn(i.label));
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
    if (this.op === "proptest") { this.literals.x1 ??= 0; this.literals.n1 ??= 1; this.literals.x2 ??= 0; this.literals.n2 ??= 1; }
    if (this.op === "binomtest") { this.literals.k ??= 0; this.literals.n ??= 1; this.literals.p0 ??= 0.5; }
  }

  /** The keys a switch to `next` would remove. Callers on a live graph prune
   *  these BEFORE calling setOp (onePrunePath). */
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
      if (!live) this.addInput(i.key, i.num ? numIn(i.label) : i.table ? tableIn(i.label) : listIn(i.label));
      else live.label = i.label; // a kept key keeps its cable; the role name follows the op
    }
    const out = this.outputs.result;
    if (out) out.label = HYPOTHESIS_TEST_SPECS[next].outLabel;
    this.seedLiterals();
    this.height = this.heightFor();
  }

  data(inputs: { a?: number[][]; b?: number[][]; x?: number[]; sigma?: number[]; groups?: (number | null)[][][]; table?: (number | null)[][][]; x1?: number[]; n1?: number[]; x2?: number[]; n2?: number[]; k?: number[]; n?: number[]; p0?: number[] }) {
    const a = inputs.a?.[0] ?? null;
    let result: number | null = null;
    // The non-Excel tests (statsOps) — every formula of the same name runs the same kernel.
    const groupsOf = (m: (number | null)[][] | null): number[][] | null => {
      if (!m || m.length === 0) return null;
      const cols = m[0].length;
      const out: number[][] = [];
      for (let c = 0; c < cols; c++) out.push(m.map((row) => row[c]).filter((v): v is number => typeof v === "number" && Number.isFinite(v)));
      return out;
    };
    if (this.op === "anova" || this.op === "kruskal") {
      const g = groupsOf(inputs.groups?.[0] ?? null);
      result = g ? (this.op === "anova" ? anovaP(g) : kruskalP(g)) : null;
    } else if (this.op === "mannwhitney" || this.op === "wilcoxon" || this.op === "ks") {
      const b = inputs.b?.[0] ?? null;
      if (a && b) result = this.op === "mannwhitney" ? mannWhitneyP(a, b) : this.op === "wilcoxon" ? wilcoxonSignedRankP(a, b) : ksTwoSampleP(a, b);
    } else if (this.op === "fisher") {
      const t = inputs.table?.[0] ?? null;
      const cell = (r: number, c: number): number | null => { const v = t?.[r]?.[c]; return typeof v === "number" ? v : null; };
      const A = cell(0, 0), B = cell(0, 1), C = cell(1, 0), D = cell(1, 1);
      result = A === null || B === null || C === null || D === null ? null : fisherExactP(A, B, C, D);
    } else if (this.op === "proptest") {
      const x1 = readInput(inputs.x1, this.literals.x1 ?? 0), n1 = readInput(inputs.n1, this.literals.n1 ?? 1);
      const x2 = readInput(inputs.x2, this.literals.x2 ?? 0), n2 = readInput(inputs.n2, this.literals.n2 ?? 1);
      result = x1 === null || n1 === null || x2 === null || n2 === null ? null : twoProportionP(x1, n1, x2, n2);
    } else if (this.op === "binomtest") {
      const k = readInput(inputs.k, this.literals.k ?? 0), n = readInput(inputs.n, this.literals.n ?? 1), p0 = readInput(inputs.p0, this.literals.p0 ?? 0.5);
      result = k === null || n === null || p0 === null ? null : binomTestP(k, n, p0);
    } else if (this.op === "z") {
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
      // ONE implementation with the formula surface (mathUtils.tTestP / fTestP — shareImpl).
      const b = inputs.b?.[0] ?? null;
      if (a && b) result = this.op === "f" ? fTestP(a, b) : tTestP(T_KERNEL_OP[this.op], a, b);
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── TREND ────────────────────────────────────────────────────────────────────

export class TrendNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    ys: "Pairs with Known Xs by position. A pair with a blank on either side is dropped, and an unmatched tail is ignored.",
    new_xs: "The Xs to predict Ys for. Leave it unwired to get the fitted Ys at the Known Xs, like Excel's omitted new_x's.",
  };

  label: string;
  /** Linear fit (TREND) or exponential fit y = b·mˣ (GROWTH). */
  mode: "linear" | "exponential" = "linear";
  cachedList: number[] | SolError = [];
  literals: Record<string, number> = {};
  width = 180; height = 245;

  constructor(init?: { label?: string; mode?: "linear" | "exponential" }) {
    super("Trend");
    this.label = init?.label ?? "TREND";
    if (init?.mode) this.mode = init.mode;
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
    // Excel: an omitted New Xs defaults to the Known Xs, so TREND returns the fitted
    // values at the known points. An unwired socket IS that omission — matches the
    // formula-surface TREND registration.
    const newXs = newXsRaw == null
      ? xs
      : (newXsRaw.filter((v): v is number => v !== null) as number[]);
    // Shared fitting kernels (mathUtils) — the TREND / GROWTH registrations run the same ones.
    let result: number[] = [];
    if (newXs.length > 0) {
      if (this.mode === "exponential") {
        const fit = expFit(xs, ys);
        result = fit ? newXs.map((x) => fit.b * Math.pow(fit.m, x)) : [];
      } else {
        const fit = linearFit(xs, ys);
        result = fit ? newXs.map((x) => fit.intercept + fit.slope * x) : [];
      }
    }
    this.cachedList = result;
    return { result };
  }
}

// ─── Interpolate (List = 1-D, Grid = fill a 2-D Z table) ──────────────────
// Two modes; the dropdown swaps the whole socket set:
//  • LIST — interpolate y for a query x between known (x, y) points.
//  • GRID — fill the blanks of a Z table; optional Xs / Ys coordinate lists ride
//    BESIDE it (unwired = the 1-based index), never in a border row/column.
// Both CLAMP at the ends (no extrapolation past the known range).

export type InterpolateMode = "list" | "grid";

export const INTERPOLATE_MODE_META: Record<InterpolateMode, { label: string; title: string }> = {
  list: { label: "List", title: "1-D: interpolate y for a query x between known (x, y) points" },
  grid: { label: "Grid", title: "Fill the blanks in a Z table by 2-D interpolation; optional Xs/Ys, unwired axes count 1, 2, 3…" },
};

// The interpolation bracket for a query against a SORTED-ASCENDING axis: [i0, i1, t]
// with value = (1-t)·v[i0] + t·v[i1], clamped at both ends (t=0 outside the range).


export class InterpolateNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    ys: "In LIST mode pairs with Known Xs by position (a pair blank on either side is dropped); in GRID mode one Y coordinate per row, unwired means 1, 2, 3…",
    new_xs: "A query outside the known range clamps to the nearest end. Nothing extrapolates.",
    xs: "LIST mode: the known x values. GRID mode: one X coordinate per column; unwired means 1, 2, 3…",
  };

  label: string;
  mode: InterpolateMode;
  // LIST mode: scalar-or-list matching the query shape. GRID mode: the filled Z table
  // (cells may be null where nothing reached). A whole-input error → SolError.
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
      this.addInput("z",  tableIn("Table"));
      this.addInput("xs", numListIn("Xs"));
      this.addInput("ys", numListIn("Ys"));
      this.addOutput("result", tableOut("Filled"));
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
    const zRaw = inputs.z?.[0] ?? null;
    if (isSolError(zRaw)) { this.cachedResult = zRaw; return { result: zRaw }; }
    // An UNWIRED axis is undefined (→ 1-based index); a WIRED blank is null (→ shape unknown,
    // null result). gridAxes validates a wired list against the row/column count.
    const xs = inputs.xs === undefined ? undefined : (inputs.xs[0] ?? null);
    const ys = inputs.ys === undefined ? undefined : (inputs.ys[0] ?? null);
    const axes = gridAxes(zRaw, xs, ys);
    if (axes === null) { this.cachedResult = null; return { result: null }; }
    if (isSolError(axes)) { this.cachedResult = axes; return { result: axes }; }
    // Carry the unitGranularity grid unit: filling blanks keeps every cell in the input's unit
    // (structural reshape, matrixUnitPolicy "carry").
    const result = carryMatrixUnit(fillGrid(axes.z, axes.xs, axes.ys, this.forecast), zRaw);
    this.cachedResult = result;
    return { result };
  }
}

// ─── LINEST ───────────────────────────────────────────────────────────────────

export class LinestNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    ys: "Pairs with Known Xs by position. A pair with a blank on either side is dropped, and an unmatched tail is ignored.",
  };

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
  static socketDocs: Record<string, string> = {
    ys: "Pairs with Known Xs by position. A pair with a blank on either side is dropped, and an unmatched tail is ignored.",
  };

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
    // ONE implementation with the formula surface (mathUtils.probBetween — shareImpl).
    const result = probBetween(range, probs, lo, hi);
    this.cachedResult = result;
    return { result };
  }
}

// ─── FORECAST (ETS) — Holt–Winters ────────────────────────────────────────────
export class EtsForecastNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    values: "An equally spaced series, oldest first — monthly sales, daily visits. Blanks are dropped.",
    horizon: "How many steps ahead to forecast.",
    season: "Season length in steps: 1 = detect it, 0 = none, 12 = yearly on monthly data. Needs two full seasons of history.",
    forecast: "One value per step ahead.",
    interval: "The 95% prediction half-width per step (forecast ± this), growing with √h.",
    detected: "The season length used — what detection found, or what you set.",
  };
  label: string;
  literals: Record<string, number> = { horizon: 6, season: 1 };
  cachedForecast: number[] | SolError | null = null;
  cachedInterval: number[] | null = null;
  cachedSeason: number | null = null;
  width = 200; height = 225;

  constructor(init?: { label?: string }) {
    super("EtsForecast");
    this.label = init?.label ?? "Forecast (ETS)";
    this.addInput("values",  listIn("Values"));
    this.addInput("horizon", numIn("Steps ahead"));
    this.addInput("season",  numIn("Season length"));
    this.addOutput("forecast", numListOut("Forecast"));
    this.addOutput("interval", numListOut("± 95%"));
    this.addOutput("detected", numOut("Season used"));
  }

  data(inputs: { values?: (number | null | SolError)[][]; horizon?: number[]; season?: number[] }) {
    const blank = () => { this.cachedForecast = null; this.cachedInterval = null; this.cachedSeason = null; return { forecast: null, interval: null, detected: null }; };
    const prep = forAggregate(inputs.values?.[0] ?? []);
    if (prep.error) { this.cachedForecast = prep.error; this.cachedInterval = null; this.cachedSeason = null; return { forecast: prep.error, interval: null, detected: null }; }
    const y = prep.nums;
    const horizon = readInput(inputs.horizon, this.literals.horizon ?? 6);
    const seasonArg = readInput(inputs.season, this.literals.season ?? 1);
    if (horizon === null || seasonArg === null || y.length < 3) return blank();
    const h = Math.max(1, Math.round(horizon));
    const m = seasonArg === 1 ? detectSeason(y) : Math.max(1, Math.round(seasonArg));
    const fit = fitEts(y, m) ?? (m > 1 ? fitEts(y, 1) : null); // too short for the season → trend-only
    if (!fit) return blank();
    this.cachedForecast = etsForecast(fit, h);
    this.cachedInterval = Array.from({ length: h }, (_, i) => etsInterval(fit, i + 1));
    this.cachedSeason = fit.season > 1 ? fit.season : 0;
    return { forecast: this.cachedForecast, interval: this.cachedInterval, detected: this.cachedSeason };
  }
}

// ─── FIT DISTRIBUTION (scipy .fit / fitdistrplus / @RISK fit) ─────────────────
export const FIT_FAMILY_LABEL: Record<FitFamily, string> = {
  normal: "Normal", lognorm: "Lognormal", expon: "Exponential", gamma: "Gamma", weibull: "Weibull",
  uniform: "Uniform", beta: "Beta", poisson: "Poisson",
};

export class FitDistributionNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    list: "A sample of values. Families whose support the data leaves (a negative value for Lognormal, a non-integer for Poisson) are skipped, not errors.",
    ranking: "Every family the data supports, best AIC first: family, parameters (the Distribution node's own), log-likelihood, AIC, KS distance.",
    best: "The family with the lowest AIC.",
    params: "That family's parameters, in the Distribution node's order — wire them straight into it.",
  };
  label: string;
  cachedRanking: FrameValue | SolError | null = null;
  cachedBest: string | null = null;
  cachedParams: number[] | null = null;
  width = 200; height = 190;

  constructor(init?: { label?: string }) {
    super("FitDistribution");
    this.label = init?.label ?? "Fit Distribution";
    this.addInput("list", listIn("Sample"));
    this.addOutput("ranking", frameOut("Ranking"));
    this.addOutput("best", strOut("Best family"));
    this.addOutput("params", numListOut("Parameters"));
  }

  data(inputs: { list?: (number | null | SolError)[][] }) {
    const prep = forAggregate(inputs.list?.[0] ?? []);
    if (prep.error) { this.cachedRanking = prep.error; this.cachedBest = null; this.cachedParams = null; return { ranking: prep.error, best: null, params: null }; }
    const fits = fitAll(prep.nums);
    if (fits.length === 0) { this.cachedRanking = null; this.cachedBest = null; this.cachedParams = null; return { ranking: null, best: null, params: null }; }
    const pname = (f: DistFit, i: number) => f.paramNames[i] ?? "";
    const pval = (f: DistFit, i: number) => (i < f.params.length ? f.params[i] : null);
    const ranking: FrameValue = { __frame: true, columns: [
      { name: "family", type: "string", values: fits.map((f) => FIT_FAMILY_LABEL[f.family]) },
      { name: "parameter 1", type: "string", values: fits.map((f) => pname(f, 0)) },
      { name: "value 1", type: "number", values: fits.map((f) => pval(f, 0)) },
      { name: "parameter 2", type: "string", values: fits.map((f) => pname(f, 1)) },
      { name: "value 2", type: "number", values: fits.map((f) => pval(f, 1)) },
      { name: "log-likelihood", type: "number", values: fits.map((f) => f.logLik) },
      { name: "AIC", type: "number", values: fits.map((f) => f.aic) },
      { name: "KS", type: "number", values: fits.map((f) => f.ks) },
    ] };
    this.cachedRanking = ranking;
    this.cachedBest = FIT_FAMILY_LABEL[fits[0].family];
    this.cachedParams = fits[0].params;
    return { ranking, best: this.cachedBest, params: this.cachedParams };
  }
}
export { FIT_FAMILIES };

// ─── DECOMPOSE (classical seasonal decomposition) ────────────────────────────
export const DECOMPOSE_MODEL_META: Record<DecomposeModel, { label: string; description: string }> = {
  additive:       { label: "Additive",       description: "y = trend + seasonal + residual; the seasonal swing is a fixed amount." },
  multiplicative: { label: "Multiplicative", description: "y = trend × seasonal × residual; the seasonal swing scales with the level (positive data)." },
  stl:            { label: "STL",            description: "Seasonal-Trend by Loess (R stl, periodic): a loess trend with no blank ends and an exactly-periodic seasonal. Additive." },
};

export class DecomposeNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    values: "An equally spaced series, oldest first; needs at least two full periods.",
    period: "Season length in steps — 12 for monthly data with a yearly cycle, 7 for daily with a weekly one.",
    trend: "Centered moving average; blank for half a period at each end (the classical filter).",
    seasonal: "One repeating pattern per period, centered to 0 (additive) or 1 (multiplicative).",
    residual: "What the trend and season leave unexplained.",
  };
  label: string;
  model: DecomposeModel = "additive";
  literals: Record<string, number> = { period: 12 };
  cachedTrend: (number | null)[] | SolError | null = null;
  cachedSeasonal: (number | null)[] | null = null;
  cachedResidual: (number | null)[] | null = null;
  width = 200; height = 225;

  constructor(init?: { label?: string; model?: DecomposeModel }) {
    super("Decompose");
    this.label = init?.label ?? "Decompose";
    if (init?.model) this.model = init.model;
    this.addInput("values", listIn("Values"));
    this.addInput("period", numIn("Period"));
    this.addOutput("trend", numListOut("Trend"));
    this.addOutput("seasonal", numListOut("Seasonal"));
    this.addOutput("residual", numListOut("Residual"));
  }

  data(inputs: { values?: (number | null | SolError)[][]; period?: number[] }) {
    const blank = (err: SolError | null = null) => { this.cachedTrend = err; this.cachedSeasonal = null; this.cachedResidual = null; return { trend: err, seasonal: null, residual: null }; };
    const raw = inputs.values?.[0] ?? null;
    const period = readInput(inputs.period, this.literals.period ?? 12);
    if (raw === null || period === null) return blank();
    const err = raw.find((v): v is SolError => isSolError(v));
    if (err) return blank(err);
    const nums = raw.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
    const d = this.model === "stl" ? stlDecompose(nums, period) : seasonalDecompose(nums, period, this.model);
    if (!d) return blank();
    this.cachedTrend = d.trend; this.cachedSeasonal = d.seasonal; this.cachedResidual = d.residual;
    return { trend: d.trend, seasonal: d.seasonal, residual: d.residual };
  }
}

// ─── ODE Integrate (RK4) — scipy solve_ivp / R deSolve ─────────────────────────

export class OdeIntegrateNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    y0: "The value of y at t0.",
    t0: "Start of the interval.",
    t1: "End of the interval.",
    steps: "Number of RK4 steps; the frame carries steps + 1 rows, t0 first.",
  };
  label: string;
  // The derivative is a LAMBDA of (t, y); a wired LAMBDA node supersedes the inline text.
  stringLiterals: Record<string, string> = { formula: "y" };
  literals: Record<string, number> = { y0: 1, t0: 0, t1: 1, steps: 100 };
  // t and y are CORRELATED (same row = same instant), so they ride ONE frame, not two lists.
  cachedResult: FrameValue | SolError | null = null;
  cachedError: string | null = null;
  readonly lambdaSig = { vars: ["t", "y"], required: 2 };
  width = 200; height = 240;

  constructor(init?: { label?: string; expr?: string }) {
    super("OdeIntegrate");
    this.label = init?.label ?? "ODE Integrate";
    if (init?.expr) this.stringLiterals.formula = init.expr;
    this.addInput("y0", numIn("y0"));
    this.addInput("t0", numIn("t0"));
    this.addInput("t1", numIn("t1"));
    this.addInput("steps", numIn("Steps"));
    // The λ socket is declared LAST so its cable-only row sits right on the FormulaBox
    // row (the MAP-family layout); the FormulaBox is the derivative's inline authoring.
    this.addInput("lambda", lambdaIn("dy/dt"));
    this.addOutput("solution", frameOut("Solution"));
  }

  data(inputs: { lambda?: unknown[]; y0?: number[]; t0?: number[]; t1?: number[]; steps?: number[] }): { solution: FrameValue | SolError | null } {
    // A wired LAMBDA(t, y, …) binds by NAME; the inline text is the fallback. Same
    // fnError/cachedError shape as the MAP family (#SYNTAX!/#NAME?/#VALUE!).
    const { fn, err, code } = resolveFn(inputs.lambda?.[0], this.stringLiterals.formula, "y", ["t", "y"], 2, true);
    if (!fn) { this.cachedResult = null; this.cachedError = err; return { solution: solError(code, err!) }; }
    this.cachedError = null;
    const y0 = readInput(inputs.y0, this.literals.y0 ?? 1);
    const t0 = readInput(inputs.t0, this.literals.t0 ?? 0);
    const t1 = readInput(inputs.t1, this.literals.t1 ?? 1);
    const steps = readInput(inputs.steps, this.literals.steps ?? 100);
    if (y0 === null || t0 === null || t1 === null || steps === null) { this.cachedResult = null; return { solution: null }; }
    // A per-step SolError or non-number result aborts the integration (→ #DOMAIN! below).
    const f = (t: number, y: number): number | null => {
      const r = fn(t, y);
      return typeof r === "number" && Number.isFinite(r) ? r : null;
    };
    const sol = rk4(f, y0, t0, t1, steps);
    if (!sol) { const e = solError("#DOMAIN!", "The integration diverged or the derivative was undefined on the interval"); this.cachedResult = e; return { solution: e }; }
    const solution: FrameValue = { __frame: true, columns: [
      { name: "t", type: "number", values: sol.t },
      { name: "y", type: "number", values: sol.y },
    ] };
    this.cachedResult = solution;
    return { solution };
  }
}
