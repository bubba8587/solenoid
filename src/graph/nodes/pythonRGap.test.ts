import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../excelFormula";
import { BinNode, OutliersNode } from "./list";
import { EpochNode, DateTruncNode } from "./date";
import { ntileList, outlierFlags } from "./listOps";
import { epochToSerial, serialToEpoch, dateTrunc } from "./dateOps";
import { parseDateToSerial } from "./dateSerial";
import { isSolError } from "../errorValue";
import { describeFrame, correlationMatrix } from "../frameVerbs";
import { amortizationSchedule } from "./financeOps";
import { anovaP, mannWhitneyP, wilcoxonSignedRankP, kruskalP, fisherExactP, ksTwoSampleP, twoProportionP, binomTestP } from "./statsOps";
import { HypothesisTestNode } from "./stats";
import { matTrace, matRank, matNorm, matSolve, matEigh } from "./matrixOps";
import { fftReal, spectrum } from "./listOps";
import { MatDetNode, MatSolveNode, MatEigenNode } from "./matrix";
import { SpectrumNode } from "./list";
import { DescribeNode, CorrMatrixNode } from "./frame";
import { AmortizationNode } from "./finance";
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
