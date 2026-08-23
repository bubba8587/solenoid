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
