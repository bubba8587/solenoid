import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../excelFormula";
import { BinNode, OutliersNode } from "./list";
import { EpochNode, DateTruncNode } from "./date";
import { ntileList, outlierFlags } from "./listOps";
import { epochToSerial, serialToEpoch, dateTrunc } from "./dateOps";
import { parseDateToSerial } from "./dateSerial";
import { isSolError } from "../errorValue";

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
