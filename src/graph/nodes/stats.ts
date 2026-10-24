// [[B11]], [[C17]] shareImpl
import { GraphNode } from "../graphModel";
import { listIn, listOut, numIn, numOut, numListIn, numListOut, tableIn, tableOut, frameOut, strOut } from "./shared";
import { rolesFrom, required, setting } from "../inputRoles";
import type { Shape } from "../frameShape";
import { lambdaIn } from "./shared";
import { type SolError } from "../errorValue";
import { nodeOnCore } from "../nodeOnCore";
import type { DecomposeModel } from "./forecastOps";
export type { DecomposeModel } from "./forecastOps";
import { FIT_FAMILIES } from "./fitOps";
import type { FrameValue } from "../frame";
import { carryMatrixUnit } from "../unitValue";

// ─── Statistics nodes ─────────────────────────────────────────────────────────

// ─── Order statistics ─────────────────────────────────────────────────────────

export type RankPercentileOp =
  | "large" | "small"
  | "rank-eq" | "rank-avg"
  | "percentile-inc" | "percentile-exc"
  | "quartile-inc" | "quartile-exc"
  | "percentrank-inc" | "percentrank-exc";

export const RANK_PERCENTILE_OP_META = {
  large:             { label: "LARGE",           description: "Kth largest value. Excel: `LARGE`." },
  small:             { label: "SMALL",           description: "Kth smallest value. Excel: `SMALL`." },
  "rank-eq":         { label: "RANK.EQ",         description: "Rank. Ties share the lowest rank. Excel: `RANK.EQ`." },
  "rank-avg":        { label: "RANK.AVG",        description: "Rank. Ties share the average rank. Excel: `RANK.AVG`." },
  "percentile-inc":  { label: "PERCENTILE.INC",  description: "Value at percentile `p` (0–1), including the endpoints. Excel: `PERCENTILE.INC`." },
  "percentile-exc":  { label: "PERCENTILE.EXC",  description: "Value at percentile `p`, excluding 0 and 1. Excel: `PERCENTILE.EXC`." },
  "quartile-inc":    { label: "QUARTILE.INC",    description: "Quartile Q0–Q4, including the endpoints. Excel: `QUARTILE.INC`." },
  "quartile-exc":    { label: "QUARTILE.EXC",    description: "Quartile Q1–Q3, excluding the endpoints. Excel: `QUARTILE.EXC`." },
  "percentrank-inc": { label: "PERCENTRANK.INC", description: "Percentile rank of a value (0–1), including the endpoints. Excel: `PERCENTRANK.INC`." },
  "percentrank-exc": { label: "PERCENTRANK.EXC", description: "Percentile rank of a value, excluding 0 and 1. Excel: `PERCENTRANK.EXC`." },
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
  rank:        { inputs: [{ key: "value", label: "Value", def: 0 }, { key: "order", label: "Order", def: 0 }],   outLabel: "Rank",       height: 210 },
  percentile:  { inputs: [{ key: "p", label: "Percentile", def: 0.5 }],                                          outLabel: "Value",      height: 185 },
  quartile:    { inputs: [{ key: "q", label: "Quartile", def: 2 }],                                              outLabel: "Value",      height: 185 },
  percentrank: { inputs: [{ key: "value", label: "Value", def: 0 }, { key: "significance", label: "Digits", def: 3 }], outLabel: "Rank (0–1)", height: 210 },
};

export class RankPercentileNode extends GraphNode {
  static inputRoles = { ...rolesFrom("LARGE", { k: 1 }), ...rolesFrom("PERCENTILE", { p: 1 }), ...rolesFrom("QUARTILE", { q: 1 }), ...rolesFrom("PERCENTRANK", { significance: 2 }), ...rolesFrom("RANK", { order: 2 }) };
  static socketDocs: Record<string, string> = {
    significance: "The rank truncates to this many digits. It does not round.",
    order: "0 ranks the largest value 1, as Excel does. Any other number ranks the smallest value 1.",
    p: "A fraction from 0 to 1.",
    q: "0 to 4: 0 = min, 1 = Q1, 2 = median, 3 = Q3, 4 = max.",
  };

  label: string;
  op: RankPercentileOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = {};
  width = 180;
  height = 185;

  constructor(init?: { label?: string; op?: RankPercentileOp }) {
    super("RankPercentile");
    this.label = init?.label ?? "";
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

  data(inputs: Record<string, unknown[] | undefined>): { result: number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

export type CorrelOp = "correl" | "rsq" | "spearman" | "kendall";

export const CORREL_OP_META = {
  correl: { label: "CORREL", description: "Pearson correlation r between two lists. Excel: `CORREL`." },
  rsq:    { label: "RSQ",    description: "R², the square of the correlation coefficient. Excel: `RSQ`." },
  spearman: { label: "SPEARMAN", description: "Spearman's ρ: Pearson over the ranks, so it follows any monotone relation and ignores outliers. scipy `spearmanr`, R `cor(method = spearman)`." },
  kendall:  { label: "KENDALL",  description: "Kendall's τ-b: concordant minus discordant pairs, tie-corrected. scipy `kendalltau`, R `cor` with `method = kendall`." },
} satisfies Record<CorrelOp, { label: string; description: string }>;

export class CorrelNode extends GraphNode {
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
    this.label = init?.label ?? "";
    this.op = init?.op ?? "correl";
    this.addInput("x", listIn("X"));
    this.addInput("y", listIn("Y"));
    this.addOutput("result", numOut("r"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── Standardize ──────────────────────────────────────────────────────────────
export class StandardizeNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { result: number | (number | SolError | null)[] | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | (number | SolError | null)[] | SolError | null };
  }
}

// ─── Covariance ───────────────────────────────────────────────────────────────
export type CovarianceOp = "pop" | "samp";

export const COVARIANCE_OP_META = {
  pop:  { label: "COVARIANCE.P", description: "Population covariance: how two lists move together. Divides by **n**. For when you have every data point. Excel: `COVARIANCE.P`." },
  samp: { label: "COVARIANCE.S", description: "Sample covariance: how two lists move together. Divides by **n−1**. For a sample of a bigger population. Excel: `COVARIANCE.S`." },
} satisfies Record<CovarianceOp, { label: string; description: string }>;

export class CovarianceNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    x: "Pairs with Y by position. A pair with a blank on either side is dropped, and an unmatched tail is ignored.",
  };

  label: string;
  op: CovarianceOp;
  cachedResult: number | SolError | null = null;
  width = 180; height = 185;

  constructor(init?: { label?: string; op?: CovarianceOp }) {
    super("Covariance");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "pop";
    this.addInput("x", listIn("X"));
    this.addInput("y", listIn("Y"));
    this.addOutput("result", numOut("Covariance"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── Fisher ───────────────────────────────────────────────────────────────────
export type FisherOp = "fisher" | "fisherinv";

export const FISHER_OP_META = {
  fisher:    { label: "FISHER",    description: "Fisher transformation: `atanh(x)`, valid for −1 < x < 1. Excel: `FISHER`." },
  fisherinv: { label: "FISHERINV", description: "Inverse Fisher: `tanh(x)`. Excel: `FISHERINV`." },
} satisfies Record<FisherOp, { label: string; description: string }>;

export class FisherNode extends GraphNode {
  label: string;
  op: FisherOp;
  cachedResult: number | (number | SolError | null)[] | SolError | null = null;
  literals: Record<string, number> = { value: 0 };
  width = 180; height = 180;

  constructor(init?: { label?: string; op?: FisherOp }) {
    super("Fisher");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "fisher";
    this.addInput("value",   numListIn("Value"));
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | (number | SolError | null)[] | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | (number | SolError | null)[] | SolError | null };
  }
}

// ─── Regression ───────────────────────────────────────────────────────────────

export type RegressionOp = "slope" | "intercept" | "steyx";

export const REGRESSION_OP_META = {
  slope:     { label: "SLOPE",     description: "Slope of linear regression line through `known_ys` and `known_xs`. Excel: `SLOPE`." },
  intercept: { label: "INTERCEPT", description: "Y-intercept of linear regression line. Excel: `INTERCEPT`." },
  steyx:     { label: "STEYX",     description: "Standard error of predicted y-values in linear regression. Excel: `STEYX`." },
} satisfies Record<RegressionOp, { label: string; description: string }>;

export class RegressionNode extends GraphNode {
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
    this.label = init?.label ?? "";
    this.op = init?.op ?? "slope";
    this.addInput("ys", listIn("Known Ys"));
    this.addInput("xs", listIn("Known Xs"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── Forecast (linear | exponential — absorbs TREND and GROWTH) ────────────────

export const FORECAST_OP_META = {
  linear:      { label: "Linear",      fx: "FORECAST.LINEAR" },
  exponential: { label: "Exponential", fx: "GROWTH" },
} as const;
export type ForecastOp = keyof typeof FORECAST_OP_META;

export class ForecastNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    ys: "Pairs with Known Xs by position. A pair with a blank on either side is dropped, and an unmatched tail is ignored.",
  };

  label: string;
  op: ForecastOp = "linear";
  cachedResult: number | (number | null)[] | SolError | null = null;
  width = 180;
  height = 215;

  constructor(init?: { label?: string; op?: ForecastOp }) {
    super("Forecast");
    this.label = init?.label ?? "";
    if (init?.op) this.op = init.op;
    this.addInput("x",  numListIn("X"));
    this.addInput("ys", listIn("Known Ys"));
    this.addInput("xs", listIn("Known Xs"));
    this.addOutput("result", numListOut("Result"));
  }

  setOp(next: ForecastOp): void { this.op = next; }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | (number | null)[] | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | (number | null)[] | SolError | null };
  }
}

// ─── Mode ─────────────────────────────────────────────────────────────────────

export class ModeNode extends GraphNode {
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
    this.addOutput("result", numListOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | number[] | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | number[] | SolError | null };
  }
}

// ─── TrimMean ─────────────────────────────────────────────────────────────────

export class TrimMeanNode extends GraphNode {
  static inputRoles = rolesFrom("TRIMMEAN", { percent: 1 });
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

  data(inputs: Record<string, unknown[] | undefined>): { result: number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── Frequency ────────────────────────────────────────────────────────────────

export class FrequencyNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { result: number[] } {
    return nodeOnCore(this, inputs) as { result: number[] };
  }
}

// ─── Confidence ───────────────────────────────────────────────────────────────

export type ConfidenceOp = "norm" | "t";

export const CONFIDENCE_OP_META = {
  norm: { label: "NORM", description: "Confidence interval half-width using normal distribution. Excel: `CONFIDENCE.NORM`." },
  t:    { label: "T",    description: "Confidence interval half-width using t-distribution. Excel: `CONFIDENCE.T`." },
} satisfies Record<ConfidenceOp, { label: string; description: string }>;

export class ConfidenceNode extends GraphNode {
  label: string;
  op: ConfidenceOp;
  cachedResult: number | null = null;
  literals: Record<string, number> = { alpha: 0.05, stdev: 1, n: 30 };
  width = 180;
  height = 235;

  constructor(init?: { label?: string; op?: ConfidenceOp }) {
    super("Confidence");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "norm";
    this.addInput("alpha", numIn("Alpha"));
    this.addInput("stdev", numIn("Std dev"));
    this.addInput("n",     numIn("Sample size"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | null } {
    return nodeOnCore(this, inputs) as { result: number | null };
  }
}

// ─── Hypothesis tests ─────────────────────────────────────────────────────────

export type HypothesisTestOp =
  | "z" | "t-paired" | "t-equal" | "t-welch" | "f" | "chisq"
  | "anova" | "mannwhitney" | "wilcoxon" | "kruskal" | "fisher" | "ks" | "proptest" | "binomtest";

export const HYPOTHESIS_TEST_OP_META = {
  z:          { label: "Z.TEST",             description: "One-tailed z-test: P(mean > μ₀) given a population or sample. Excel: `Z.TEST`." },
  "t-paired": { label: "T.TEST (paired)",    description: "Paired t-test: the same subjects measured twice, 2-tailed. Excel: `T.TEST` type 1." },
  "t-equal":  { label: "T.TEST (equal var)", description: "Two-sample t-test with pooled variance, 2-tailed. Excel: `T.TEST` type 2." },
  "t-welch":  { label: "T.TEST (Welch)",     description: "Two-sample t-test assuming unequal variances: Welch's t-test, 2-tailed. Excel: `T.TEST` type 3." },
  f:          { label: "F.TEST",             description: "Two-tailed F-test for equal variances. Excel: `F.TEST`." },
  chisq:      { label: "CHISQ.TEST",         description: "Chi-square goodness-of-fit test (observed vs. expected). Excel: `CHISQ.TEST`." },
  anova:      { label: "ANOVA",              description: "One-way ANOVA: do k groups share a mean? Each table column is a group (blanks skipped); the upper-tail F p-value. scipy `f_oneway`, R `aov`. No Excel function, only the Data Analysis add-in." },
  mannwhitney:{ label: "Mann–Whitney U",     description: "Two-sided rank-sum test, two independent samples; normal approximation, tie and continuity corrected. R `wilcox.test`, scipy `mannwhitneyu`." },
  wilcoxon:   { label: "Wilcoxon signed-rank", description: "Paired nonparametric test: ranks of the paired differences, zeros dropped, two-sided with continuity correction. R `wilcox.test` with `paired = TRUE`." },
  kruskal:    { label: "Kruskal–Wallis",     description: "Nonparametric one-way ANOVA over k groups (table columns), tie-corrected H against χ². scipy `kruskal`, R `kruskal.test`." },
  fisher:     { label: "Fisher exact",       description: "Fisher's exact test on a 2×2 table of counts, two-sided: the small-sample answer where `CHISQ.TEST` is unreliable. R `fisher.test`, scipy `fisher_exact`." },
  ks:         { label: "KS (2-sample)",      description: "Two-sample Kolmogorov–Smirnov: are two samples from the same distribution? Asymptotic two-sided p. scipy `ks_2samp`, R `ks.test`." },
  proptest:   { label: "Two-proportion z",   description: "Are two success rates different? x₁ of n₁ vs x₂ of n₂, pooled z, two-sided, no continuity correction (statsmodels `proportions_ztest`; R `prop.test(correct=FALSE)`)." },
  binomtest:  { label: "Binomial test",      description: "Exact test of k successes in n against a hypothesised rate p₀, two-sided. scipy `binomtest`, R `binom.test`." },
} satisfies Record<HypothesisTestOp, { label: string; description: string }>;

interface HypothesisTestSpec {
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
      { key: "sigma", label: "σ", num: true },
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

export class HypothesisTestNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    sigma: "Left unset, the sample's own standard deviation is used. A wired blank instead blanks the result.",
  };

  label: string;
  op: HypothesisTestOp;
  cachedResult: number | SolError | null = null;
  literals: Record<string, number> = {};
  width = 180;
  height = 210;

  constructor(init?: { label?: string; op?: HypothesisTestOp }) {
    super("HypothesisTest");
    this.label = init?.label ?? "";
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
      else live.label = i.label;
    }
    const out = this.outputs.result;
    if (out) out.label = HYPOTHESIS_TEST_SPECS[next].outLabel;
    this.seedLiterals();
    this.height = this.heightFor();
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── Interpolate (List = 1-D, Grid = fill a 2-D Z table) ──────────────────

export type InterpolateMode = "list" | "grid";

export const INTERPOLATE_MODE_META: Record<InterpolateMode, { label: string; title: string }> = {
  list: { label: "List", title: "1-D: interpolate y for a query x between known (x, y) points" },
  grid: { label: "Grid", title: "Fill the blanks in a Z table by 2-D interpolation; optional Xs/Ys, unwired axes count 1, 2, 3…" },
};



export class InterpolateNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    ys: "In LIST mode pairs with Known Xs by position (a pair blank on either side is dropped); in GRID mode one Y coordinate per row, unwired means 1, 2, 3…",
    new_xs: "A query outside the known range clamps to the nearest end. Nothing extrapolates.",
    xs: "LIST mode: the known x values. GRID mode: one X coordinate per column; unwired means 1, 2, 3…",
  };

  label: string;
  mode: InterpolateMode;
  cachedResult: number | (number | null)[] | (number | null)[][] | SolError | null = null;
  literals: Record<string, number> = { x: 0 };
  // Grid mode's typed Xs / Ys lists need these string slots, like a List Input.
  stringLiterals: Record<string, string> = { xs: "", ys: "" };
  forecast = true;
  width = 180; height = 215;

  constructor(init?: { label?: string; mode?: InterpolateMode; forecast?: boolean }) {
    super("Interpolate");
    this.label = init?.label ?? "INTERPOLATE";
    this.mode = init?.mode ?? "list";
    if (init?.forecast != null) this.forecast = init.forecast;
    this._rebuildSockets();
  }

  // Removes every socket, so callers prune all of this node's cables first (applyInterpolateMode).
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
    this.addInput("new_xs", numListIn("X"));
    this.addOutput("result", numListOut("Interpolated Y"));
    this.height = 215;
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | (number | null)[] | (number | null)[][] | SolError | null } {
    const out = nodeOnCore(this, inputs) as { result: number | (number | null)[] | (number | null)[][] | SolError | null };
    if (this.mode !== "grid") return out;
    // A table's unit rides beside its numbers, off the wire, so the filled table takes it back here.
    const z = inputs.z?.[0];
    this.cachedResult = carryMatrixUnit(this.cachedResult, z);
    return { result: carryMatrixUnit(out.result, z) };
  }
}

// ─── Fit — LINEST | LOGEST (linear | exponential op) ──────────────────────────

export const FIT_OP_META = {
  linear:      { label: "Linear",      fx: "LINEST" },
  exponential: { label: "Exponential", fx: "LOGEST" },
} as const;
export type FitOp = keyof typeof FIT_OP_META;

export const FIT_OP_OPTIONS: { value: FitOp; label: string; title?: string }[] = [
  { value: "linear",      label: "linear", title: "Straight-line fit: slope, intercept and R². Excel: LINEST" },
  { value: "exponential", label: "exp",    title: "Growth-curve fit y = b·mˣ: m, b and R² on the log scale. Excel: LOGEST" },
];

export class LinestNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    ys: "Pairs with Known Xs by position. A pair with a blank on either side is dropped, and an unmatched tail is ignored. Exponential: every Y must be > 0.",
  };

  label: string;
  op: FitOp = "linear";
  cachedSlope:     number | SolError | null = null;
  cachedIntercept: number | SolError | null = null;
  cachedR2:        number | SolError | null = null;
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: FitOp }) {
    super("Linest");
    this.label = init?.label ?? "";
    if (init?.op) this.op = init.op;
    this.addInput("ys", listIn("Known Ys"));
    this.addInput("xs", listIn("Known Xs"));
    this.addOutput("slope",     numOut(this.op === "exponential" ? "m" : "Slope"));
    this.addOutput("intercept", numOut(this.op === "exponential" ? "b" : "Intercept"));
    this.addOutput("r2",        numOut(this.op === "exponential" ? "R² (log)" : "R²"));
  }

  setOp(next: FitOp): void {
    this.op = next;
    const exp = next === "exponential";
    this.outputs.slope!.label     = exp ? "m"        : "Slope";
    this.outputs.intercept!.label = exp ? "b"        : "Intercept";
    this.outputs.r2!.label        = exp ? "R² (log)" : "R²";
  }

  data(inputs: Record<string, unknown[] | undefined>): { slope: number | SolError | null; intercept: number | SolError | null; r2: number | SolError | null } {
    return nodeOnCore(this, inputs) as { slope: number | SolError | null; intercept: number | SolError | null; r2: number | SolError | null };
  }
}

// ─── BINOM.DIST.RANGE ────────────────────────────────────────────────────────

export class BinomDistRangeNode extends GraphNode {
  label: string;
  cachedResult: number | null = null;
  literals: Record<string, number> = { n: 10, p: 0.5, lo: 0, hi: 10 };
  width = 180; height = 240;

  constructor(init?: { label?: string }) {
    super("BinomDistRange");
    this.label = init?.label ?? "BINOM.DIST.RANGE";
    this.addInput("n",  numIn("Trials"));
    this.addInput("p",  numIn("Probability"));
    this.addInput("lo", numIn("lower bound"));
    this.addInput("hi", numIn("upper bound"));
    this.addOutput("result", numOut("P(lo ≤ X ≤ hi)"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: number | null } {
    return nodeOnCore(this, inputs) as { result: number | null };
  }
}

// ─── PROB ─────────────────────────────────────────────────────────────────────

export class ProbNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { result: number | SolError | null } {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
  }
}

// ─── FORECAST (ETS) — Holt–Winters ────────────────────────────────────────────
export class EtsForecastNode extends GraphNode {
  static inputRoles = { horizon: required, season: setting(1) };
  static socketDocs: Record<string, string> = {
    values: "An equally spaced series, oldest first: monthly sales, daily visits. Blanks are dropped.",
    horizon: "How many steps ahead to forecast.",
    season: "Season length in steps: 1 = detect it, 0 = none, 12 = yearly on monthly data. Needs two full seasons of history.",
    forecast: "A frame per step ahead: Forecast (the point forecast) and Interval, the 95% prediction half-width (forecast ± this), growing with √h.",
    detected: "The season length used: what detection found, or what you set.",
  };
  label: string;
  literals: Record<string, number> = { horizon: 6, season: 1 };
  cachedResult: FrameValue | SolError | null = null;
  cachedSeason: number | null = null;
  width = 200; height = 205;

  constructor(init?: { label?: string }) {
    super("EtsForecast");
    this.label = init?.label ?? "Forecast (ETS)";
    this.addInput("values",  listIn("Values"));
    this.addInput("horizon", numIn("Steps ahead"));
    this.addInput("season",  numIn("Season length"));
    this.addOutput("forecast", frameOut("Forecast"));
    this.addOutput("detected", numOut("Season used"));
  }

  frameShape(outKey: string): Shape | null {
    return outKey === "forecast" ? { columns: [{ name: "Forecast", type: "number" }, { name: "Interval", type: "number" }] } : null;
  }

  data(inputs: Record<string, unknown[] | undefined>): { forecast: FrameValue | SolError | null; detected: number | null } {
    return nodeOnCore(this, inputs) as { forecast: FrameValue | SolError | null; detected: number | null };
  }
}

export class FitDistributionNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    list: "A sample of values. Families whose support the data leaves (a negative value for Lognormal, a non-integer for Poisson) are skipped, not errors.",
    ranking: "Every family the data supports, best AIC first: family, parameters (the Distribution node's own), log-likelihood, AIC, KS distance.",
    best: "The family with the lowest AIC.",
    params: "That distribution's parameters, in the Distribution node's order, ready to connect to it.",
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

  frameShape(outKey: string): Shape | null {
    if (outKey !== "ranking") return null;
    return { columns: [
      { name: "family", type: "string" }, { name: "parameter 1", type: "string" }, { name: "value 1", type: "number" },
      { name: "parameter 2", type: "string" }, { name: "value 2", type: "number" },
      { name: "log-likelihood", type: "number" }, { name: "AIC", type: "number" }, { name: "KS", type: "number" },
    ] };
  }

  data(inputs: Record<string, unknown[] | undefined>): { ranking: FrameValue | SolError | null; best: string | null; params: number[] | null } {
    return nodeOnCore(this, inputs) as { ranking: FrameValue | SolError | null; best: string | null; params: number[] | null };
  }
}
export { FIT_FAMILIES };

// ─── DECOMPOSE (classical seasonal decomposition) ────────────────────────────
export const DECOMPOSE_MODEL_META: Record<DecomposeModel, { label: string; description: string }> = {
  additive:       { label: "Additive",       description: "`y = trend + seasonal + residual`; the seasonal swing is a fixed amount." },
  multiplicative: { label: "Multiplicative", description: "`y = trend × seasonal × residual`; the seasonal swing scales with the level. Positive data only." },
  stl:            { label: "STL",            description: "Seasonal-Trend by Loess (R `stl`, periodic): a loess trend with no blank ends and an exactly-periodic seasonal. Additive." },
};

export class DecomposeNode extends GraphNode {
  static inputRoles = { period: required };
  static socketDocs: Record<string, string> = {
    values: "An equally spaced series, oldest first; needs at least two full periods.",
    period: "Season length in steps: 12 for monthly data with a yearly cycle, 7 for daily with a weekly one.",
    decomposition: "A frame of three aligned columns: Trend (centered MA, blank half a period at each end for the classical filter; a loess with no blank ends for STL), Seasonal (one repeating pattern, centered), and Residual, what's left.",
  };
  label: string;
  model: DecomposeModel = "additive";
  literals: Record<string, number> = { period: 12 };
  cachedResult: FrameValue | SolError | null = null;
  width = 200; height = 205;

  constructor(init?: { label?: string; model?: DecomposeModel }) {
    super("Decompose");
    this.label = init?.label ?? "Decompose";
    if (init?.model) this.model = init.model;
    this.addInput("values", listIn("Values"));
    this.addInput("period", numIn("Period"));
    this.addOutput("decomposition", frameOut("Decomposition"));
  }

  frameShape(): Shape {
    return { columns: [{ name: "Trend", type: "number" }, { name: "Seasonal", type: "number" }, { name: "Residual", type: "number" }] };
  }

  data(inputs: Record<string, unknown[] | undefined>): { decomposition: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { decomposition: FrameValue | SolError | null };
  }
}

// ─── ODE Integrate (RK4) — scipy solve_ivp / R deSolve ─────────────────────────

export class OdeIntegrateNode extends GraphNode {
  static inputRoles = { steps: setting(100) };
  static socketDocs: Record<string, string> = {
    y0: "The value of y at t0.",
    t0: "Start of the interval.",
    t1: "End of the interval.",
    steps: "Number of RK4 steps; the frame carries steps + 1 rows, t0 first.",
  };
  label: string;
  stringLiterals: Record<string, string> = { formula: "y" };
  literals: Record<string, number> = { y0: 1, t0: 0, t1: 1, steps: 100 };
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
    // Declared last so its cable-only row sits on the FormulaBox row (the MAP-family layout).
    this.addInput("lambda", lambdaIn("dy/dt"));
    this.addOutput("solution", frameOut("Solution"));
  }

  frameShape(): Shape {
    return { columns: [{ name: "t", type: "number" }, { name: "y", type: "number" }] };
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { solution: FrameValue | SolError | null };
  }
}
