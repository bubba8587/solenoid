import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../excelFormula";
import { BinNode, OutliersNode } from "./list";
import { EpochNode, DateTruncNode } from "./date";
import { ntileList, outlierFlags } from "./listOps";
import { epochToSerial, serialToEpoch, dateTrunc } from "./dateOps";
import { parseDateToSerial } from "./dateSerial";
import { isSolError } from "../errorValue";
import { describeFrame, correlationMatrix, windowFrame } from "../frameVerbs";
import { WindowNode } from "./frame";
import { readFrame } from "../frameBackend";
import { amortizationSchedule } from "./financeOps";
import { anovaP, mannWhitneyP, wilcoxonSignedRankP, kruskalP, fisherExactP, ksTwoSampleP, twoProportionP, binomTestP } from "./statsOps";
import { HypothesisTestNode } from "./stats";
import { matTrace, matRank, matNorm, matSolve, matEigh } from "./matrixOps";
import { fftReal, spectrum } from "./listOps";
import { MatDetNode, MatSolveNode, MatEigenNode } from "./matrix";
import { SpectrumNode } from "./list";
import { levenshtein, damerauLevenshtein, jaroWinkler, textSimilarity, fuzzyBest } from "./textOps";
import { TextSimilarityNode, FuzzyMatchNode, TextTransformNode, PadTextNode, TruncateTextNode, HashNode, UuidNode, UrlEncodeNode, TemplateNode } from "./text";
import { templatePlaceholders, renderTemplate } from "./textOps";
import { requestRecalc } from "../process";
import { unaccent, slugify, padText, truncateText } from "./textOps";
import { argsortList, whichPositions } from "./listOps";
import { ArgMinMaxNode, SmoothNode, FindPeaksNode } from "./list";
import { numListOut, numOut, listIn, logicalListIn } from "./shared";
import { fitEts, etsForecast, etsInterval, detectSeason } from "./forecastOps";
import { EtsForecastNode, FitDistributionNode } from "./stats";
import { fitDistribution, fitAll } from "./fitOps";
import { DescribeNode, CorrMatrixNode } from "./frame";
import { AmortizationNode, ReturnsNode } from "./finance";
import { periodReturns, cumulativeReturns, drawdowns, maxDrawdown, cagr, volatility, sharpeRatio, sortinoRatio } from "./financeOps";
import type { FrameValue } from "../frame";

// python-r-gap.md Tier 1: quantile bins, outliers, epoch, date truncation. Each formula
// runs its node's kernel; values pinned against pandas / R / scipy conventions.
const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const d = (s: string) => parseDateToSerial(s);

describe("NTILE / Bin quantiles mode (dplyr ntile, pandas qcut)", () => {
  it("splits into equal-count buckets 1..n, blanks stay blank, errors ride", () => {
    expect(ntileList([1, 2, 3, 4, 5, 6, 7, 8], 4)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(ntileList([10, null, 30, 20], 2)).toEqual([1, null, 2, 2]);
    expect(isSolError(ntileList([1, 2], 0))).toBe(true);
    expect(ev("NTILE(x, 4)", { x: [1, 2, 3, 4, 5, 6, 7, 8] })).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it("the Bin node's quantiles mode == the formula, and the mode swaps the second socket", () => {
    const n = new BinNode({ mode: "quantiles" });
    expect(n.inputs.n).toBeDefined(); expect(n.inputs.breaks).toBeUndefined();
    expect(n.data({ list: [[1, 2, 3, 4, 5, 6, 7, 8]], n: [4] }).result).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    n.setMode("breaks");
    expect(n.inputs.breaks).toBeDefined(); expect(n.inputs.n).toBeUndefined();
    expect(n.data({ list: [[3, 7, 12]], breaks: [[5, 10]] }).result).toEqual([0, 1, 2]);
    expect(n.outputs.result!.label).toBe("Bin index");
  });
});

describe("ISOUTLIER / Outliers node", () => {
  const x = [10, 11, 9, 10, 12, 10, 11, 100];
  it("z / IQR / MAD rules flag the 100; too few or flat flags nothing", () => {
    expect(outlierFlags(x, "iqr", 1.5)).toEqual([false, false, false, false, false, false, false, true]);
    expect(outlierFlags(x, "mad", 3.5)).toEqual([false, false, false, false, false, false, false, true]);
    // z with n=8 and one huge value: the outlier inflates sd so |z| ≈ 2.47 < 3 — the known weakness of the z rule
    expect(outlierFlags(x, "z", 2)).toEqual([false, false, false, false, false, false, false, true]);
    expect(outlierFlags([1, 2], "z", 3)).toEqual([false, false]);
    expect(outlierFlags([5, 5, 5, 5], "iqr", 1.5)).toEqual([false, false, false, false]);
    expect(outlierFlags([1, null, 100, 1, 1, 1], "iqr", 1.5)[1]).toBeNull();
  });
  it("formula == node; the node also hands back the cleaned list with outliers blanked", () => {
    expect(ev("ISOUTLIER(x, \"iqr\")", { x })).toEqual(outlierFlags(x, "iqr", 1.5));
    expect(ev("ISOUTLIER(x)", { x })).toEqual(outlierFlags(x, "z", 3)); // default z / 3
    const n = new OutliersNode({ method: "iqr" });
    const out = n.data({ list: [x] });
    expect(out.flags).toEqual(outlierFlags(x, "iqr", 1.5));
    expect(out.clean).toEqual([10, 11, 9, 10, 12, 10, 11, null]);
    expect(isSolError(ev("ISOUTLIER(x, \"huh\")", { x }))).toBe(true);
  });
});

describe("FROMEPOCH / TOEPOCH", () => {
  it("1970-01-01 is serial 25569; seconds and milliseconds both ways", () => {
    expect(epochToSerial(0, "s")).toBe(25569);
    expect(epochToSerial(86400, "s")).toBe(25570);
    expect(epochToSerial(1_700_000_000, "s")).toBeCloseTo(d("2023-11-14") + 22.2222 / 24, 3); // 2023-11-14T22:13:20Z
    expect(serialToEpoch(epochToSerial(1_700_000_000_000, "ms"), "ms")).toBeCloseTo(1_700_000_000_000, 3);
    expect(ev("FROMEPOCH(0)")).toBe(25569);
    expect(ev("TOEPOCH(25570, \"ms\")")).toBe(86400000);
    expect(isSolError(ev("TOEPOCH(25570, \"h\")"))).toBe(true);
    expect(new EpochNode({ op: "from" }).data({ value: [86400] }).result).toBe(25570);
    expect(new EpochNode({ op: "to", unit: "ms" }).data({ value: [25570] }).result).toBe(86400000);
  });
});

describe("DATETRUNC / Truncate Date (floor_date / ceiling_date)", () => {
  const x = d("2026-03-18") + 0.6; // a Wednesday, mid-afternoon
  it("floors to day / week / month / quarter / year", () => {
    expect(dateTrunc(x, "day")).toBe(d("2026-03-18"));
    expect(dateTrunc(x, "week")).toBe(d("2026-03-16"));      // Monday
    expect(dateTrunc(x, "week_sun")).toBe(d("2026-03-15"));  // Sunday
    expect(dateTrunc(x, "month")).toBe(d("2026-03-01"));
    expect(dateTrunc(x, "quarter")).toBe(d("2026-01-01"));
    expect(dateTrunc(x, "year")).toBe(d("2026-01-01"));
  });
  it("ceiling is the next period start, a boundary stays put (lubridate ceiling_date)", () => {
    expect(dateTrunc(x, "month", true)).toBe(d("2026-04-01"));
    expect(dateTrunc(x, "quarter", true)).toBe(d("2026-04-01"));
    expect(dateTrunc(x, "year", true)).toBe(d("2027-01-01"));
    expect(dateTrunc(x, "week", true)).toBe(d("2026-03-23"));
    expect(dateTrunc(d("2026-03-01"), "month", true)).toBe(d("2026-03-01"));
    expect(dateTrunc(d("2026-12-15"), "month", true)).toBe(d("2027-01-01"));
  });
  it("formula == node, unit spellings from Excel/pandas/lubridate accepted", () => {
    expect(ev("DATETRUNC(x, \"month\")", { x })).toBe(d("2026-03-01"));
    expect(ev("DATETRUNC(x, \"M\")", { x })).toBe(d("2026-03-01"));
    expect(ev("DATETRUNC(x, \"quarter\", TRUE)", { x })).toBe(d("2026-04-01"));
    expect(isSolError(ev("DATETRUNC(x, \"fortnight\")", { x }))).toBe(true);
    expect(new DateTruncNode({ unit: "week" }).data({ date: [x] }).result).toBe(d("2026-03-16"));
    expect(new DateTruncNode({ unit: "year", ceiling: true }).data({ date: [x] }).result).toBe(d("2027-01-01"));
  });
});

describe("Haversine (geometry pack)", () => {
  it("London → Paris ≈ 343.5 km (geopy great_circle / distHaversine)", () => {
    const km = ev("2*6371.0088*ASIN(SQRT(SIN((lat2-lat1)*PI()/360)^2+COS(lat1*PI()/180)*COS(lat2*PI()/180)*SIN((lon2-lon1)*PI()/360)^2))",
      { lat1: 51.5074, lon1: -0.1278, lat2: 48.8566, lon2: 2.3522 });
    expect(km).toBeCloseTo(343.5, 0);
  });
});

describe("Describe (pandas describe / R summary)", () => {
  const f: FrameValue = { __frame: true, columns: [
    { name: "x", type: "number", values: [1, 2, 3, 4, null] },
    { name: "s", type: "string", values: ["a", "b", "a", null, "c"] },
    { name: "d", type: "date", values: [45000, 45001, null, 45003, 45004] },
  ] };
  it("one row per column; numeric stats on number columns, counts everywhere", () => {
    const out = describeFrame(f);
    const col = (n: string) => out.columns.find((c) => c.name === n)!.values;
    expect(col("column")).toEqual(["x", "s", "d"]);
    expect(col("count")).toEqual([4, 4, 4]);
    expect(col("blank")).toEqual([1, 1, 1]);
    expect(col("distinct")).toEqual([4, 3, 4]);
    expect(col("mean")).toEqual([2.5, null, null]);
    expect(col("std")![0]).toBeCloseTo(1.2909944487358056, 12); // pandas ddof=1
    expect(col("25%")).toEqual([1.75, null, null]);
    expect(col("50%")).toEqual([2.5, null, null]);
    expect(col("max")).toEqual([4, null, 45004]);
    expect(new DescribeNode().data({ frame: [f] }).frame).toEqual(out);
  });
});

describe("Correlation Matrix (df.corr / cor)", () => {
  const f: FrameValue = { __frame: true, columns: [
    { name: "a", type: "number", values: [1, 2, 3, 4, 5] },
    { name: "b", type: "number", values: [2, 4, 6, 8, 10] },
    { name: "c", type: "number", values: [5, 3, null, 1, 0] },
    { name: "label", type: "string", values: ["p", "q", "r", "s", "t"] },
  ] };
  it("pairwise-complete Pearson, symmetric, ones on the diagonal; text columns skipped", () => {
    const out = correlationMatrix(f, "pearson");
    expect(out.columns.map((c) => c.name)).toEqual(["column", "a", "b", "c"]);
    const row = (i: number) => out.columns.slice(1).map((c) => c.values[i]);
    expect(row(0)[0]).toBe(1);
    expect(row(0)[1]).toBeCloseTo(1, 12);
    expect(row(0)[2]).toBeCloseTo(-0.9880643635111419, 10); // a vs c over the 4 complete rows: [1,2,4,5] vs [5,3,1,0]
    expect(row(2)[0]).toBeCloseTo(row(0)[2] as number, 12);   // symmetric
    const cov = correlationMatrix(f, "covariance");
    expect(cov.columns[1].values[0]).toBeCloseTo(2.5, 12);    // var(a) sample
    expect(new CorrMatrixNode({ method: "spearman" }).data({ frame: [f] }).frame).toEqual(correlationMatrix(f, "spearman"));
  });
});

describe("Amortization schedule", () => {
  it("balance amortizes to 0; interest + principal = payment each period; totals match CUMIPMT", () => {
    const rows = amortizationSchedule(0.005, 12, 10000);
    expect(rows).toHaveLength(12);
    expect(rows[0].payment).toBeCloseTo(-860.664, 3); // PMT(0.5%, 12, 10000)
    expect(rows[0].interest).toBeCloseTo(-50, 12);
    for (const r of rows) expect(r.interest + r.principal).toBeCloseTo(r.payment, 9);
    expect(rows[11].balance).toBeCloseTo(0, 6);
    const totalInterest = rows.reduce((a, r) => a + r.interest, 0);
    expect(totalInterest).toBeCloseTo(-327.97, 1); // Excel CUMIPMT(0.005,12,10000,1,12,0)
    expect(amortizationSchedule(0, 4, 1000)[0].payment).toBe(-250);
    expect(amortizationSchedule(0.01, 0, 1000)).toEqual([]);
  });
  it("payment at the start of the period bears no first-period interest", () => {
    const rows = amortizationSchedule(0.005, 12, 10000, 0, 1);
    expect(rows[0].interest).toBe(0);
    expect(rows[11].balance).toBeCloseTo(0, 6);
    const node = new AmortizationNode(); node.literals = { rate: 0.005, nper: 12, pv: 10000, fv: 0 };
    const f = node.data({}).frame!;
    expect(f.columns.map((c) => c.name)).toEqual(["Period", "Payment", "Interest", "Principal", "Balance"]);
    expect(f.columns[4].values[11] as number).toBeCloseTo(0, 6);
  });
});

describe("Hypothesis tests beyond Excel's four (values from scipy / R)", () => {
  const g1 = [6.9, 5.4, 5.8, 4.6, 4.0], g2 = [8.3, 6.8, 7.8, 9.2, 6.5], g3 = [8.0, 10.5, 8.1, 6.9, 9.3];
  it("ANOVA: scipy.stats.f_oneway(g1, g2, g3).pvalue = 0.0032482226", () => {
    expect(anovaP([g1, g2, g3])).toBeCloseTo(0.0032482226008593, 10);
    expect(ev("ANOVA(a, b, c)", { a: g1, b: g2, c: g3 })).toBeCloseTo(0.0032482226008593, 10);
    expect(anovaP([g1])).toBeNull();
  });
  it("Kruskal–Wallis: scipy.stats.kruskal(g1, g2, g3).pvalue = 0.0150708773", () => {
    expect(kruskalP([g1, g2, g3])).toBeCloseTo(0.015070877263608444, 10);
    expect(ev("KRUSKAL(a, b, c)", { a: g1, b: g2, c: g3 })).toBeCloseTo(0.015070877263608444, 10);
  });
  it("Mann–Whitney U, asymptotic with continuity + ties: scipy mannwhitneyu(method=asymptotic) p = 0.13291946", () => {
    const x = [1.83, 0.50, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.30], y = [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29];
    expect(mannWhitneyP(x, y)).toBeCloseTo(0.13291945818531892, 10); // R's depression data (unpaired); ties → asymptotic on both
    expect(ev("MANNWHITNEY(x, y)", { x, y })).toBeCloseTo(0.13291945818531892, 10);
  });
  it("Wilcoxon signed-rank (paired, continuity): scipy wilcoxon(mode=approx, correction=True) p = 0.04401098", () => {
    const x = [1.83, 0.50, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.30], y = [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29];
    expect(wilcoxonSignedRankP(x, y)).toBeCloseTo(0.04401098401295143, 10); // R's exact answers 0.03906; this is the continuity-corrected normal form
    expect(ev("WILCOXON(x, y)", { x, y })).toBeCloseTo(0.04401098401295143, 10);
    expect(wilcoxonSignedRankP([1, 2], [1, 2])).toBeNull(); // all zero differences
  });
  it("Fisher exact on the tea-tasting table [[3,1],[1,3]]: p = 0.4857; a 2×2 formula == node", () => {
    expect(fisherExactP(3, 1, 1, 3)).toBeCloseTo(0.4857142857142857, 10);
    expect(fisherExactP(10, 0, 0, 10)).toBeCloseTo(1.0825088224469026e-5, 12); // scipy fisher_exact
    expect(ev("FISHEREXACT(3, 1, 1, 3)")).toBeCloseTo(0.4857142857142857, 10);
    expect(new HypothesisTestNode({ op: "fisher" }).data({ table: [[[3, 1], [1, 3]]] }).result).toBeCloseTo(0.4857142857142857, 10);
  });
  it("KS two-sample EXACT: scipy ks_2samp(method=exact) — 0.16782134 on 10 vs 10, 0.05949591 on 40 vs 35", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], b = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    expect(ksTwoSampleP(a, b)).toBeCloseTo(0.16782134274394334, 10);
    expect(ev("KSTEST(a, b)", { a, b })).toBeCloseTo(0.16782134274394334, 10);
    const big1 = [0.346, 0.822, 0.33, -1.303, 0.905, 0.446, -0.537, 0.581, 0.365, 0.294, 0.028, 0.547, -0.736, -0.163, -0.482, 0.599, 0.04, -0.292, -0.782, -0.257, 0.008, -0.276, 1.294, 1.007, -2.711, -1.889, -0.175, -0.422, 0.214, 0.217, 2.118, -1.112, -0.378, 2.043, 0.647, 0.663, -0.514, -1.648, 0.167, 0.109];
    const big2 = [-0.627, -0.083, 0.528, -0.345, 0.502, 0.695, 0.636, 0.094, 1.194, 1.491, 0.921, -0.218, 1.332, 0.099, 1.479, -0.472, 1.514, 0.58, -0.649, 0.286, 0.654, 0.873, -0.382, -0.507, 0.8, 0.133, 0.836, 1.36, -1.049, 0.854, 1.825, 0.302, -0.211, 1.352, 0.853];
    expect(ksTwoSampleP(big1, big2)).toBeCloseTo(0.059495912884303954, 9);
    expect(ksTwoSampleP(a, a)).toBe(1);
  });
  it("two-proportion z (pooled, no correction): z = 0.15/sqrt(0.375·0.625·0.02) = 2.1909 → p = 0.0284597", () => {
    expect(twoProportionP(45, 100, 30, 100)).toBeCloseTo(0.02845973691631065, 10);
    expect(ev("PROPTEST(45, 100, 30, 100)")).toBeCloseTo(twoProportionP(45, 100, 30, 100) as number, 12);
  });
  it("binomial test two-sided exact: scipy binomtest(7, 20, 0.5).pvalue = 0.2632", () => {
    expect(binomTestP(7, 20, 0.5)).toBeCloseTo(0.2631759643554688, 10);
    expect(binomTestP(9, 10, 0.5)).toBeCloseTo(0.021484375, 12);
    expect(ev("BINOMTEST(7, 20, 0.5)")).toBeCloseTo(0.2631759643554688, 10);
  });
  it("the card's op switch swaps to a table socket for ANOVA and back to lists", () => {
    const n = new HypothesisTestNode({ op: "t-welch" });
    n.setOp("anova");
    expect(n.inputs.groups).toBeDefined(); expect(n.inputs.a).toBeUndefined();
    expect(n.data({ groups: [[[6.9, 8.3, 8.0], [5.4, 6.8, 10.5], [5.8, 7.8, 8.1], [4.6, 9.2, 6.9], [4.0, 6.5, 9.3]]] }).result).toBeCloseTo(0.0032482226008593, 10);
    n.setOp("proptest");
    expect(n.inputs.x1).toBeDefined(); expect(n.inputs.groups).toBeUndefined();
  });
});

describe("linear algebra set (numpy.linalg reference values)", () => {
  const A = [[4, 1, 2], [1, 3, 0], [2, 0, 5]];
  it("trace / rank / Frobenius norm", () => {
    expect(matTrace(A)).toBe(12);
    expect(matRank([[1, 2, 3], [2, 4, 6], [1, 1, 1]])).toBe(2);
    expect(matNorm(A)).toBeCloseTo(7.745966692414834, 12);
    expect(ev("TRACE(m)", { m: A })).toBe(12);
    expect(ev("MATRIXRANK(m)", { m: [[1, 2, 3], [2, 4, 6], [1, 1, 1]] })).toBe(2);
    expect(ev("NORM(m)", { m: A })).toBeCloseTo(7.745966692414834, 12);
    expect(new MatDetNode({ op: "trace" }).data({ matrix: [A] }).result).toBe(12);
    expect(new MatDetNode({ op: "rank" }).data({ matrix: [[[1, 2], [2, 4]]] }).result).toBe(1);
  });
  it("SOLVE: numpy.linalg.solve; singular is #DIV/0!", () => {
    const x = matSolve(A, [7, 5, 9])!;
    [0.6046511627906977, 1.4651162790697674, 1.5581395348837208].forEach((v, i) => expect(x[i]).toBeCloseTo(v, 12));
    expect(matSolve([[1, 2], [2, 4]], [1, 2])).toBeNull();
    const viaFormula = ev("SOLVE(m, b)", { m: A, b: [7, 5, 9] }) as number[];
    viaFormula.forEach((v, i) => expect(v).toBeCloseTo(x[i], 12));
    expect(isSolError(new MatSolveNode().data({ matrix: [[[1, 2], [2, 4]]], b: [[1, 2]] }).result)).toBe(true);
  });
  it("EIGEN (symmetric): numpy.linalg.eigh values descending, unit eigenvectors as columns, A·v = λ·v", () => {
    const e = matEigh(A)!;
    [6.669079088282288, 3.476023602918134, 1.854897308799577].forEach((v, i) => expect(e.values[i]).toBeCloseTo(v, 10));
    for (let c = 0; c < 3; c++) {
      const v = e.vectors.map((r) => r[c]);
      const Av = A.map((r) => r.reduce((a, x, k) => a + x * v[k], 0));
      Av.forEach((val, k) => expect(val).toBeCloseTo(e.values[c] * v[k], 9));
      expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    }
    expect(matEigh([[1, 2], [3, 4]])).toBeNull(); // not symmetric
    const node = new MatEigenNode().data({ matrix: [A] });
    expect(node.values).toEqual(e.values);
    expect(ev("EIGENVALUES(m)", { m: A })).toEqual(e.values);
  });
});

describe("Spectrum (FFT) — numpy.fft reference", () => {
  it("fftReal matches numpy.fft.fft on a non-power-of-two length (Bluestein)", () => {
    const { re, im } = fftReal([1, 2, 3, 4, 5, 6, 7]);
    const wantRe = [28, -3.5, -3.5, -3.5, -3.5, -3.5, -3.5];
    const wantIm = [0, 7.267824888003178, 2.7911568610884143, 0.7988521603655251, -0.7988521603655251, -2.7911568610884143, -7.267824888003178];
    re.forEach((v, i) => expect(v).toBeCloseTo(wantRe[i], 10));
    im.forEach((v, i) => expect(v).toBeCloseTo(wantIm[i], 10));
  });
  it("a 5 Hz sine of amplitude 3 on a 1 V offset, sampled 64/s: bin 5 reads 3 at 5 Hz, DC reads 1", () => {
    const sig = Array.from({ length: 64 }, (_, i) => 3 * Math.sin((2 * Math.PI * 5 * i) / 64) + 1);
    const rows = spectrum(sig, 64);
    expect(rows).toHaveLength(33);
    expect(rows[5].frequency).toBe(5);
    expect(rows[5].magnitude).toBeCloseTo(3, 10);
    expect(rows[0].magnitude).toBeCloseTo(1, 10);
    expect(rows[7].magnitude).toBeCloseTo(0, 10);
    const node = new SpectrumNode(); node.literals.rate = 64;
    const out = node.data({ list: [sig] }).result!;
    expect(out[5][0]).toBe(5); expect(out[5][1] as number).toBeCloseTo(3, 10);
    const viaFormula = ev("SPECTRUM(s, 64)", { s: sig }) as number[][];
    expect(viaFormula[5][1]).toBeCloseTo(3, 10);
  });
});

describe("string distance / fuzzy match (textbook values; rapidfuzz / stringdist conventions)", () => {
  it("Levenshtein, Damerau, Jaro–Winkler, ratio", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(damerauLevenshtein("teh", "the")).toBe(1);
    expect(levenshtein("teh", "the")).toBe(2);
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.9611111111111111, 10);
    expect(jaroWinkler("DWAYNE", "DUANE")).toBeCloseTo(0.84, 10);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
    expect(textSimilarity("kitten", "sitting", "ratio")).toBeCloseTo(1 - 3 / 7, 12);
    expect(textSimilarity("", "", "ratio")).toBe(1);
    expect(ev("LEVENSHTEIN(\"kitten\", \"sitting\")")).toBe(3);
    expect(ev("SIMILARITY(\"MARTHA\", \"MARHTA\", \"jaro_winkler\")")).toBeCloseTo(0.9611111111111111, 10);
    expect(new TextSimilarityNode({ method: "damerau" }).data({ a: ["teh"], b: ["the"] }).result).toBeCloseTo(1 - 1 / 3, 12);
  });
  it("Fuzzy Match picks the closest candidate above the threshold, #N/A below it; a list of needles spills", () => {
    const cands = ["New York", "Los Angeles", "Chicago", "Houston"];
    expect(fuzzyBest("Chicgo", cands, "ratio", 0.6)).toMatchObject({ text: "Chicago", index: 2 });
    expect(fuzzyBest("Zurich", cands, "ratio", 0.6)).toBeNull();
    expect(ev("FUZZYMATCH(\"New Yrok\", c)", { c: cands })).toBe("New York");
    expect(isSolError(ev("FUZZYMATCH(\"Zurich\", c)", { c: cands }))).toBe(true);
    const n = new FuzzyMatchNode(); n.literals.threshold = 0.6;
    const out = n.data({ needle: [["Chicgo", "Houstin", "Zurich"]], candidates: [cands] });
    expect((out.match as unknown[])[0]).toBe("Chicago");
    expect((out.match as unknown[])[1]).toBe("Houston");
    expect(isSolError((out.match as unknown[])[2])).toBe(true);
    expect((out.score as number[])[0]).toBeCloseTo(1 - 1 / 7, 12);
  });
});

describe("Forecast (ETS) — Holt–Winters", () => {
  // A clean series: level 100, slope 2 per step, additive season of length 12 and amplitude 10.
  const y = Array.from({ length: 36 }, (_, t) => 100 + 2 * t + 10 * Math.sin((2 * Math.PI * t) / 12));
  it("detects the 12-step season and forecasts the continuation of trend + season", () => {
    expect(detectSeason(y)).toBe(12);
    const fit = fitEts(y, 12)!;
    expect(fit.season).toBe(12);
    const fc = etsForecast(fit, 12);
    for (let k = 1; k <= 12; k++) {
      const t = 35 + k;
      expect(fc[k - 1]).toBeCloseTo(100 + 2 * t + 10 * Math.sin((2 * Math.PI * t) / 12), 0); // within ±0.5 on a noiseless series
    }
    expect(etsInterval(fit, 4)).toBeGreaterThan(etsInterval(fit, 1)); // the band grows with √h
  });
  it("trend-only (Holt) on a straight line extrapolates it; too short is blank", () => {
    const line = [3, 5, 7, 9, 11, 13, 15, 17];
    const fit = fitEts(line, 1)!;
    expect(etsForecast(fit, 3).map((v) => Math.round(v * 1000) / 1000)).toEqual([19, 21, 23]);
    expect(fitEts([1, 2], 1)).toBeNull();
    expect(fitEts(line, 12)).toBeNull(); // fewer than two seasons
  });
  it("node and FORECAST.ETS family agree; the formula reads Excel's timeline / target convention", () => {
    const node = new EtsForecastNode(); node.literals = { horizon: 3, season: 1 };
    const out = node.data({ values: [y] });
    expect(out.detected).toBe(12);
    const timeline = y.map((_, i) => 45000 + i); // daily serials, equally spaced
    expect(ev("FORECAST.ETS(t, v, tl)", { t: 45000 + 36 + 2, v: y, tl: timeline })).toBeCloseTo((out.forecast as number[])[2], 10);
    expect(ev("FORECAST.ETS.SEASONALITY(v)", { v: y })).toBe(12);
    expect(ev("FORECAST.ETS.CONFINT(t, v, tl)", { t: 45000 + 36, v: y, tl: timeline })).toBeCloseTo(out.interval![0], 10);
    expect(ev("FORECAST.ETS.SEASONALITY(v)", { v: [3, 5, 7, 9, 11, 13, 15, 17] })).toBe(0);
    expect(isSolError(ev("FORECAST.ETS(t, v, tl)", { t: 45000, v: y, tl: timeline }))).toBe(true); // target not past the end
  });
});

describe("Window — per-group columns in original row order (pandas groupby().transform / SQL OVER)", () => {
  const f: FrameValue = { __frame: true, columns: [
    { name: "g", type: "string", values: ["a", "b", "a", "b", "a", "b"] },
    { name: "t", type: "number", values: [3, 1, 1, 2, 2, 3] },
    { name: "v", type: "number", values: [10, 20, 30, null, 50, 60] },
  ] };
  const col = (out: FrameValue, name: string) => out.columns.find((c) => c.name === name)!.values;
  const run = (fn: string, extra: Record<string, unknown> = {}) =>
    col(windowFrame(f, { partitionBy: ["g"], orderBy: "t", fn: fn as never, column: "v", as: "out", ...extra }), "out");
  it("running sum / row number / lag / diff / pct_change follow the Order column within each group", () => {
    expect(run("cumsum")).toEqual([90, 20, 30, null, 80, 80]);
    expect(run("row_number")).toEqual([3, 1, 1, 2, 2, 3]);
    expect(run("lag", { n: 1 })).toEqual([50, null, null, 20, 30, null]);
    expect(run("lead", { n: 1 })).toEqual([null, null, 50, 60, 10, null]);
    expect(run("diff")).toEqual([-40, null, null, null, 20, null]);
    const pc = run("pct_change") as (number | null)[];
    expect(pc[4]).toBeCloseTo(2 / 3, 12); expect(pc[0]).toBeCloseTo(-0.8, 12); expect(pc[2]).toBeNull();
    expect(run("rolling_sum", { n: 2 })).toEqual([60, null, null, null, 80, 60]);
  });
  it("ranks: competition, dense, percent; ntile; blanks rank blank", () => {
    const byV = (fn: string) => col(windowFrame(f, { partitionBy: ["g"], orderBy: "v", fn: fn as never, as: "r" }), "r");
    expect(byV("rank")).toEqual([1, 1, 2, null, 3, 2]);
    expect(run("dense_rank")).toEqual([3, 1, 1, 2, 2, 3]);           // dense rank by t
    expect(byV("percent_rank")).toEqual([0, 0, 0.5, null, 1, 1]);
    expect(run("ntile", { n: 3 })).toEqual([3, 1, 1, 2, 2, 3]);
    const tied: FrameValue = { __frame: true, columns: [{ name: "k", type: "number", values: [5, 5, 7, 9] }] };
    expect(col(windowFrame(tied, { partitionBy: [], orderBy: "k", fn: "rank", as: "r" }), "r")).toEqual([1, 1, 3, 4]);
    expect(col(windowFrame(tied, { partitionBy: [], orderBy: "k", fn: "dense_rank", as: "r" }), "r")).toEqual([1, 1, 2, 3]);
  });
  it("group aggregates repeat per row; share divides by the group total; first/last honor the order", () => {
    expect(run("group_sum")).toEqual([90, 80, 90, 80, 90, 80]);
    expect(run("group_count")).toEqual([3, 2, 3, 2, 3, 2]);
    const sh = run("share") as (number | null)[];
    expect(sh[1]).toBeCloseTo(0.25, 12); expect(sh[5]).toBeCloseTo(0.75, 12); expect(sh[3]).toBeNull();
    expect(run("first")).toEqual([30, 20, 30, 20, 30, 20]);
    expect(run("last")).toEqual([10, 60, 10, 60, 10, 60]);
  });
  it("no partition = the whole frame; no order = input order; a missing column is #REF!", async () => {
    expect(col(windowFrame(f, { partitionBy: [], fn: "cumsum", column: "v", as: "c" }), "c")).toEqual([10, 30, 60, null, 110, 170]);
    expect(() => windowFrame(f, { partitionBy: ["nope"], fn: "row_number", as: "r" })).toThrow();
    const node = new WindowNode({ op: "cumsum" }); node.stringLiterals = { orderBy: "t", column: "v", name: "" };
    const out = await readFrame((await node.data({ frame: [f], keys: [["g"]] })).frame as never) as FrameValue; // lazy node → collect
    expect(out.columns.map((c) => c.name)).toEqual(["g", "t", "v", "running_sum_v"]);
    expect(col(out, "running_sum_v")).toEqual([90, 20, 30, null, 80, 80]);
  });
});

describe("Fit Distribution (scipy.stats.<dist>.fit with loc fixed at 0; references computed locally)", () => {
  const normal = [50.01, 52.39, 47.807, 42.875, 46.363, 42.067, 50.481, 60.722, 46.062, 45.036, 53.919, 52.855, 50.843, 42.556, 49.766, 55.562, 39.246, 46.339, 34.79, 39.684, 35.266, 48.119, 39.86, 52.17, 51.254, 48.505, 29.866, 45.69, 49.612, 50.906, 37.759, 46.178, 42.172, 43.529, 58.487, 43.54, 49.74, 57.075, 45.331, 49.106, 50.884, 50.51, 40.2, 50.609, 60.871, 37.623, 56.875, 50.955, 44.868, 66.003, 56.098, 40.406, 50.596, 54.614, 48.49, 55.463, 49.468, 55.338, 61.508, 44.595];
  const gamma = [7.4389, 7.0784, 4.2628, 11.3314, 2.2322, 9.7956, 4.6617, 13.7808, 5.1595, 5.4566, 4.7872, 8.1846, 5.6672, 6.4493, 13.129, 6.394, 5.1117, 6.4762, 2.3036, 5.246, 7.2517, 3.4755, 7.4499, 5.7517, 10.1216, 2.9205, 6.6571, 7.7163, 11.8068, 6.9024, 5.9902, 2.6746, 0.9033, 3.4356, 7.0956, 13.7236, 6.2137, 5.8193, 12.6582, 6.2766, 4.1088, 13.7812, 11.7664, 3.8905, 4.3267, 15.2916, 5.2635, 3.5484, 3.9636, 8.1063, 1.9613, 4.0894, 10.3154, 6.8206, 8.7222, 5.8892, 2.473, 4.508, 6.3519, 4.505];
  const weibull = [1.7331, 1.3532, 1.971, 6.3685, 2.1115, 12.7547, 1.4775, 6.7843, 4.2176, 9.082, 1.3785, 7.1777, 18.0275, 10.6528, 5.7628, 12.9813, 8.2315, 3.754, 13.5897, 2.3645, 13.0238, 14.6899, 9.9682, 5.5984, 14.6648, 3.0534, 6.4013, 11.9235, 9.891, 9.058, 24.6557, 8.6749, 4.4808, 7.7891, 12.5102, 3.5004, 12.5551, 17.767, 9.1013, 2.5291, 4.9693, 6.296, 8.3783, 6.9626, 14.2832, 9.7913, 4.7693, 1.4389, 4.8358, 4.8651, 12.4886, 5.8338, 16.4789, 9.6223, 10.9156, 13.0275, 1.1126, 9.6578, 3.3529, 9.447];
  it("normal MLE == scipy norm.fit; KS matches kstest", () => {
    const f = fitDistribution(normal, "normal")!;
    expect(f.params[0]).toBeCloseTo(48.3252, 10);
    expect(f.params[1]).toBeCloseTo(7.054268591427463, 10);
    expect(f.ks).toBeCloseTo(0.07233794786468928, 10);
  });
  it("gamma MLE (shape by Newton on the profile likelihood) == scipy gamma.fit(floc=0)", () => {
    const f = fitDistribution(gamma, "gamma")!;
    expect(f.params[0]).toBeCloseTo(3.9158925878647577, 6);
    expect(f.params[1]).toBeCloseTo(1.7002249637709617, 6);
  });
  it("weibull MLE: the exact root of the profile-likelihood equation (scipy's fmin lands 5e-6 away)", () => {
    const f = fitDistribution(weibull, "weibull")!;
    expect(f.params[0]).toBeCloseTo(1.6875841271298682, 9); // brentq root of Σxᵏln x/Σxᵏ − 1/k − mean(ln x); scipy: 1.687589
    expect(f.params[1]).toBeCloseTo(9.18942, 4);
  });
  it("the ranking picks the generating family by AIC; unsupported families are skipped, not errors", () => {
    expect(fitAll(normal)[0].family).toBe("normal");
    expect(fitAll(gamma)[0].family).toBe("gamma");
    expect(fitDistribution([-1, 2, 3, 4], "lognorm")).toBeNull();
    expect(fitDistribution([1.5, 2, 3], "poisson")).toBeNull();
    const node = new FitDistributionNode().data({ list: [normal] });
    expect(node.best).toBe("Normal");
    expect((node.params as number[])[0]).toBeCloseTo(48.3252, 10);
    expect(ev("FITDIST(x)", { x: normal })).toBe("normal");
    expect((ev("FITDIST(x, \"gamma\")", { x: gamma }) as number[])[0]).toBeCloseTo(3.9158925878647577, 6);
    expect(isSolError(ev("FITDIST(x, \"cauchy\")", { x: gamma }))).toBe(true);
  });
});

describe("text tier 2: UNACCENT / SLUGIFY / Pad Text / Truncate Text", () => {
  const ev = (e: string) => compileEvaluator(e)!({});
  it("unaccent strips diacritics and transliterates the undecomposable letters", () => {
    expect(unaccent("Crème Brûlée")).toBe("Creme Brulee");
    expect(unaccent("Straße Øresund Łódź")).toBe("Strasse Oresund Lodz");
    expect(unaccent("plain")).toBe("plain");
  });
  it("slugify: lowercase, runs of non-alphanumerics collapse to one separator, ends trimmed", () => {
    expect(slugify("  Hello, World! Été 2026 ")).toBe("hello-world-ete-2026");
    expect(slugify("a__b--c", "_")).toBe("a_b_c");
    expect(slugify("***")).toBe("");
  });
  it("padText: side is where the padding goes; fill cycles; never shortens; center puts the odd one right", () => {
    expect(padText("ab", 5, "left")).toBe("   ab");
    expect(padText("ab", 5, "right", "-")).toBe("ab---");
    expect(padText("ab", 5, "center", "*")).toBe("*ab**");
    expect(padText("7", 3, "left", "0")).toBe("007");
    expect(padText("abc", 6, "right", "xy")).toBe("abcxyx");
    expect(padText("toolong", 3, "left")).toBe("toolong");
    expect(padText("éa", 4, "left", "é")).toBe("éééa"); // code points, not UTF-16 units
  });
  it("truncateText: at most width, ellipsis counts toward it, untouched when it fits", () => {
    expect(truncateText("The quick brown fox", 10)).toBe("The quick…");
    expect(truncateText("The quick brown fox", 10, "...")).toBe("The qui...");
    expect(truncateText("short", 10)).toBe("short");
    expect(truncateText("abcdef", 2, "...")).toBe("..");
    expect(truncateText("abcdef", 3, "")).toBe("abc");
  });
  it("the nodes broadcast over a strcombo list; the formulas agree", () => {
    const x = new TextTransformNode({ op: "slugify" });
    expect(x.data({ text: [["Café Noir", "B&B Inn"]] }).result).toEqual(["cafe-noir", "b-b-inn"]);
    expect(new TextTransformNode({ op: "unaccent" }).data({ text: ["naïve"] }).result).toBe("naive");
    const pad = new PadTextNode({ op: "left" });
    pad.literals.width = 4; pad.stringLiterals.fill = "0";
    expect(pad.data({ text: [["7", "42"]] }).result).toEqual(["0007", "0042"]);
    const tr = new TruncateTextNode();
    tr.literals.width = 5;
    expect(tr.data({ text: ["abcdefgh"] }).result).toBe("abcd…");
    expect(ev('UNACCENT("über")')).toBe("uber");
    expect(ev('SLUGIFY("Hello World", "_")')).toBe("hello_world");
    expect(ev('PADTEXT("7", 3, "left", "0")')).toBe("007");
    expect(ev('PADTEXT("ab", 4)')).toBe("ab  ");
    expect((ev('PADTEXT("ab", 4, "middle")') as { code?: string }).code).toBe("#DOMAIN!");
    expect(ev('TRUNCATETEXT("abcdefgh", 5, "..")')).toBe("abc..");
  });
});

describe("positions: ARGSORT / WHICH on the ARGMAX card (numpy.argsort, R order / which)", () => {
  it("argsort is 1-based and stable; blanks and errors sort last either way", () => {
    expect(argsortList([30, 10, 20])).toEqual([2, 3, 1]);
    expect(argsortList([30, 10, 20], true)).toEqual([1, 3, 2]);
    expect(argsortList([2, 1, 2, null, 1])).toEqual([2, 5, 1, 3, 4]);
    expect(argsortList([2, null, 1], true)).toEqual([1, 3, 2]);
  });
  it("which returns the TRUE positions; numbers count when non-zero, text when non-empty", () => {
    expect(whichPositions([false, true, true, false, true])).toEqual([2, 3, 5]);
    expect(whichPositions([0, 3, null, -1, ""])).toEqual([2, 4]);
    expect(whichPositions([])).toEqual([]);
  });
  it("the card retypes its sockets across ops and computes each", () => {
    const n = new ArgMinMaxNode({ op: "argmax" });
    expect(n.data({ list: [[3, 9, 4]] }).result).toBe(2);
    expect(n.setOp("argsort")).toEqual({ inputChanged: false, outputChanged: true });
    expect(n.outputs.result!.socket).toBe(numListOut("x").socket);
    expect(n.data({ list: [[3, 9, 4]] }).result).toEqual([1, 3, 2]);
    expect(n.setOp("which")).toEqual({ inputChanged: true, outputChanged: false });
    expect(n.inputs.list!.socket).toBe(logicalListIn("x").socket);
    expect(n.data({ list: [[true, false, true] as unknown as number[]] }).result).toEqual([1, 3]);
    expect(n.setOp("argmin")).toEqual({ inputChanged: true, outputChanged: true });
    expect(n.inputs.list!.socket).toBe(listIn("x").socket);
    expect(n.outputs.result!.socket).toBe(numOut("x").socket);
    expect(n.data({ list: [[3, 9, 4]] }).result).toBe(1);
  });
  it("formulas: ARGSORT(list, [desc]) and WHICH(flags)", () => {
    const evx = (e: string) => compileEvaluator(e)!({ x: [30, 10, 20] });
    expect(evx("ARGSORT(x)")).toEqual([2, 3, 1]);
    expect(evx("ARGSORT(x, TRUE)")).toEqual([1, 3, 2]);
    expect(evx("WHICH(x > 15)")).toEqual([1, 3]);
  });
});

describe("Returns card — pandas pct_change / cumprod, PerformanceAnalytics (references computed locally)", () => {
  const P = [100, 102, 101, 105, 103, 108, 110, 107];
  const R = [0.02, -0.0098039216, 0.0396039604, -0.019047619, 0.0485436893, 0.0185185185, -0.0272727273];
  const close = (xs: unknown, ys: (number | null)[]) => {
    const a = xs as (number | null)[];
    expect(a.length).toBe(ys.length);
    a.forEach((v, i) => (ys[i] === null ? expect(v).toBeNull() : expect(v).toBeCloseTo(ys[i] as number, 8)));
  };
  it("log / simple returns lead with a blank; a blank price blanks both neighbours", () => {
    close(periodReturns(P, true), [null, 0.0198026273, -0.0098522964, 0.0388398333, -0.0192313619, 0.0474022389, 0.0183491387, -0.0276515313]);
    close(periodReturns(P, false), [null, ...R]);
    close(periodReturns([100, null, 110, 121], false), [null, null, null, 0.1]);
  });
  it("cumulative return compounds; drawdown is ≤ 0 from the running peak; max drawdown is its minimum", () => {
    close(cumulativeReturns(R), [0.02, 0.01, 0.05, 0.03, 0.08, 0.1, 0.07]);
    close(drawdowns(P), [0, 0, -0.0098039216, 0, -0.019047619, 0, 0, -0.0272727273]);
    expect(maxDrawdown(P)).toBeCloseTo(-0.0272727273, 8);
    expect(maxDrawdown([])).toBeNull();
  });
  it("CAGR / volatility / Sharpe / Sortino annualise by periods per year; rf is per period", () => {
    expect(cagr(P, 252)).toBeCloseTo(10.423942188538536, 6);
    expect(cagr(P, 1)).toBeCloseTo(Math.pow(1.07, 1 / 7) - 1, 10);
    expect(volatility(R, 252)).toBeCloseTo(0.46552064666834575, 8);
    expect(sharpeRatio(R, 0, 252)).toBeCloseTo(5.455200388274644, 6);
    expect(sharpeRatio(R, 0.001, 252)).toBeCloseTo(4.913871014801045, 6);
    expect(sortinoRatio(R, 0.001, 252)).toBeCloseTo(10.501642446871466, 6);
    expect((sharpeRatio([0.01, 0.01, 0.01]) as { code?: string }).code).toBe("#DIV/0!");
    expect((cagr([0, 5]) as { code?: string }).code).toBe("#DOMAIN!");
  });
  it("the card swaps its rf / periods sockets and output rank with the op; formulas agree", () => {
    const n = new ReturnsNode({ op: "log" });
    expect(Object.keys(n.inputs)).toEqual(["list"]);
    close(n.data({ list: [P] }).result, [null, 0.0198026273, -0.0098522964, 0.0388398333, -0.0192313619, 0.0474022389, 0.0183491387, -0.0276515313]);
    expect(n.setOp("sharpe")).toEqual({ removed: [], outputChanged: true });
    expect(Object.keys(n.inputs).sort()).toEqual(["list", "periods", "rf"]);
    n.literals.periods = 252;
    expect(n.data({ list: [R] }).result).toBeCloseTo(5.455200388274644, 6);
    expect(n.setOp("maxdrawdown")).toEqual({ removed: ["rf", "periods"], outputChanged: false });
    expect(Object.keys(n.inputs)).toEqual(["list"]);
    expect(n.data({ list: [P] }).result).toBeCloseTo(-0.0272727273, 8);
    const ev = (e: string) => compileEvaluator(e)!({ p: P, r: R });
    expect(ev("MAXDRAWDOWN(p)")).toBeCloseTo(-0.0272727273, 8);
    expect(ev("CAGR(p, 252)")).toBeCloseTo(10.423942188538536, 6);
    expect(ev("SHARPE(r, 0.001, 252)")).toBeCloseTo(4.913871014801045, 6);
    expect(ev("SORTINO(r, 0.001, 252)")).toBeCloseTo(10.501642446871466, 6);
    expect(ev("VOLATILITY(r, 252)")).toBeCloseTo(0.46552064666834575, 8);
    close(ev("CUMRETURNS(r)"), [0.02, 0.01, 0.05, 0.03, 0.08, 0.1, 0.07]);
    close(ev("DRAWDOWN(p)"), [0, 0, -0.0098039216, 0, -0.019047619, 0, 0, -0.0272727273]);
    close(ev("LOGRETURNS(p)"), [null, 0.0198026273, -0.0098522964, 0.0388398333, -0.0192313619, 0.0474022389, 0.0183491387, -0.0276515313]);
  });
});

describe("Hash / UUID / Base64 (hashlib, uuid4, base64 — digests pinned in hashOps.test.ts)", () => {
  const ev = (e: string) => compileEvaluator(e)!({});
  it("the Hash card broadcasts and follows its algorithm; HASH(text, [algorithm]) agrees", () => {
    const n = new HashNode({ op: "md5" });
    expect(n.data({ text: [["abc", "hello world"]] }).result).toEqual(["900150983cd24fb0d6963f7d28e17f72", "5eb63bbbe01eeed093cb22bb8f5acdc3"]);
    n.op = "crc32";
    expect(n.data({ text: ["abc"] }).result).toBe("352441c2");
    expect(ev('HASH("abc")')).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(ev('HASH("abc", "SHA-1")')).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(ev('HASH("abc", "fnv1a64")')).toBe("e71fa2190541574b");
    expect((ev('HASH("abc", "blake")') as { code?: string }).code).toBe("#DOMAIN!");
  });
  it("UUID is stable within a recalculation and fresh after one; the formula is volatile", async () => {
    const n = new UuidNode();
    const a = n.data().result;
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(n.data().result).toBe(a);
    await requestRecalc();
    expect(n.data().result).not.toBe(a);
    expect(ev("UUID()")).not.toBe(ev("UUID()"));
  });
  it("ENCODEBASE64 / DECODEBASE64 ride the url-encode card; bad base64 passes through", () => {
    expect(new UrlEncodeNode({ op: "base64" }).data({ text: ["hello world"] }).result).toBe("aGVsbG8gd29ybGQ=");
    expect(new UrlEncodeNode({ op: "unbase64" }).data({ text: ["aGVsbG8gd29ybGQ="] }).result).toBe("hello world");
    expect(new UrlEncodeNode({ op: "unbase64" }).label).toBe("DECODEBASE64");
    expect(ev('ENCODEBASE64("abc")')).toBe("YWJj");
    expect(ev('DECODEBASE64("YWJj")')).toBe("abc");
    expect(ev('DECODEBASE64("not base64!")')).toBe("not base64!");
  });
});

describe("Template — str_glue / f-string placeholders", () => {
  const ev = (e: string, env: Record<string, unknown> = {}) => compileEvaluator(e)!(env);
  it("the kernel finds distinct names in order, honours {{ }} and a :spec", () => {
    expect(templatePlaceholders("Hi {name}, {total:0.00} for {name} — {{literal}} {0}")).toEqual(["name", "total", "0"]);
    const out = renderTemplate("{a}+{b:x}={{}}", (n) => ({ a: 1, b: 2 } as Record<string, number>)[n], (v, _n, spec) => `${v}${spec ? "[" + spec + "]" : ""}`);
    expect(out).toBe("1+2[x]={}");
  });
  it("the node grows a socket per name, formats numbers through TEXT, broadcasts a list", async () => {
    const n = new TemplateNode();
    n.stringLiterals.template = "Hello {name}, total {total:0.00}";
    expect(n.data({}).result).toBe("Hello , total "); // a blank prints as nothing, even with a spec
    await Promise.resolve(); // the microtask that grows the sockets
    expect(Object.keys(n.inputs)).toEqual(["template", "name", "total"]);
    expect(n.data({ name: ["Ada"], total: [1234.5] }).result).toBe("Hello Ada, total 1234.50");
    expect(n.data({ name: [["Ada", "Bob"]], total: [7] }).result).toEqual(["Hello Ada, total 7.00", "Hello Bob, total 7.00"]);
    n.stringLiterals.template = "{name} only";
    n.data({});
    await Promise.resolve(); await Promise.resolve();
    expect(Object.keys(n.inputs)).toEqual(["template", "name"]);
    expect(n.sideVars).toEqual(["name"]);
    // a save restores the sockets before any cable lands
    expect(Object.keys(new TemplateNode({ sideVars: ["x", "y"] }).inputs)).toEqual(["template", "x", "y"]);
  });
  it("TEMPLATE(text, v0, v1…) is positional; a named placeholder is #NAME?", () => {
    expect(ev('TEMPLATE("{0} owes {1:0.00}", "Ada", 12.5)')).toBe("Ada owes 12.50");
    expect(ev('TEMPLATE("{{x}} = {0}", TRUE)')).toBe("{x} = TRUE");
    expect(ev('TEMPLATE("{0} and {1}", "a")')).toBe("a and ");
    expect((ev('TEMPLATE("Hi {name}", "Ada")') as { code?: string }).code).toBe("#NAME?");
  });
});

describe("Smooth / Find Peaks cards (kernels pinned against scipy in signalOps.test.ts)", () => {
  const X = [1, 3, 2, 5, 4, 6, 8, 7, 9, 12, 10, 11];
  const Y = [0, 1, 0, 2, 0, 3, 2, 3, 0, 5, 4, 0, 1, 1, 1, 0];
  it("Smooth swaps its parameter sockets with the op; the formulas agree", () => {
    const n = new SmoothNode({ op: "savgol" });
    expect(Object.keys(n.inputs)).toEqual(["list", "window", "order"]);
    expect((n.data({ list: [X] }).result as number[])[0]).toBeCloseTo(1.114286, 5);
    expect(n.setOp("gaussian")).toEqual(["window", "order"]);
    expect(Object.keys(n.inputs)).toEqual(["list", "sigma"]);
    expect((n.data({ list: [X] }).result as number[])[0]).toBeCloseTo(1.669012, 5);
    expect(n.setOp("lowess")).toEqual(["sigma"]);
    expect(Object.keys(n.inputs)).toEqual(["list", "frac"]);
    const ev = (e: string) => compileEvaluator(e)!({ x: X, y: Y });
    expect((ev("SAVGOL(x, 5, 2)") as number[])[11]).toBeCloseTo(10.6, 5);
    expect((ev("GAUSSIANSMOOTH(x, 2)") as number[])[0]).toBeCloseTo(2.331121, 5);
    expect((ev("LOWESS(x, 0.5)") as number[]).length).toBe(12);
    expect(ev("FINDPEAKS(y)")).toEqual([2, 4, 6, 8, 10, 14]);
    expect(ev("FINDPEAKS(y, 2.5)")).toEqual([6, 8, 10]);
    expect(ev("FINDPEAKS(y, 0, 1, 2)")).toEqual([4, 6, 8, 10]);
  });
  it("Find Peaks: unwired filters mean none; positions + heights", () => {
    const n = new FindPeaksNode();
    expect(n.data({ list: [Y] })).toEqual({ positions: [2, 4, 6, 8, 10, 14], values: [1, 2, 3, 3, 5, 1] });
    n.literals.prominence = 2;
    expect(n.data({ list: [Y] }).positions).toEqual([4, 6, 8, 10]);
    expect(n.data({ list: [Y], distance: [3] }).positions).toEqual([6, 10]);
  });
});
