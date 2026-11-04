// [[C17]] shareImpl, [[D114]] dateIsAKind, [[date-values#Cards]]
import { describe, it, expect } from "vitest";
import { solDate } from "../../../src/graph/dateValue";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { DateConstructNode, TimeConstructNode, DateTimeValueNode, WeekInfoNode, DateDiffNode } from "../../../src/graph/nodes/date";
import { parseDateToSerial } from "../../../src/graph/nodes/dateSerial";
import { isSolError } from "../../../src/graph/errorValue";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const d = (s: string) => parseDateToSerial(s);
/** A date variable crosses as a date ([[D114]] dateIsAKind). */
const D = (n: number) => solDate(n);
const same = (a: unknown, b: unknown) => {
  if (isSolError(a) || isSolError(b)) expect(isSolError(a) && isSolError(b) && a.code === b.code, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(true);
  else expect(a).toEqual(b);
};

describe("date formulas == date nodes", () => {
  it("DATE keeps the node's LITERAL year (26 is the year 26) and #DOMAIN! outside 1–9999", () => {
    for (const [y, m, dd] of [[2026, 3, 15], [26, 1, 1], [2024, 14, 31], [0, 1, 1], [10000, 1, 1]]) {
      same(ev("DATE(y, m, d)", { y, m, d: dd }), new DateConstructNode().data({ year: [y], month: [m], day: [dd] }).result);
    }
  });
  it("TIME wraps past 24 h like the node", () => {
    for (const [h, m, s] of [[12, 0, 0], [25, 30, 0], [0, 90, 0], [23, 59, 59.5]]) {
      same(ev("TIME(h, m, s)", { h, m, s }), new TimeConstructNode().data({ hour: [h], minute: [m], second: [s] }).result);
    }
  });
  it("DATEVALUE / TIMEVALUE run the node's parsers (#AMBIGUOUS! and #VALUE! included)", () => {
    for (const t of ["15 March 1996", "2026-03-15", "3/4/2026", "nonsense"]) {
      const n = new DateTimeValueNode({ op: "date" }); n.stringLiterals.text = t;
      same(ev("DATEVALUE(t)", { t }), n.data({}).result);
    }
    for (const t of ["14:30:00", "2:30 pm", "2026-03-15 06:00", "25:00"]) {
      const n = new DateTimeValueNode({ op: "time" }); n.stringLiterals.text = t;
      same(ev("TIMEVALUE(t)", { t }), n.data({}).result);
    }
  });
  it("WEEKDAY / WEEKNUM / ISOWEEKNUM with every return_type", () => {
    const dates = [d("2026-01-01"), d("2026-03-15"), d("2024-12-30"), d("2021-01-03")];
    for (const x of dates) {
      for (const rt of [1, 2, 3]) same(ev("WEEKDAY(x, rt)", { x: D(x), rt }), new WeekInfoNode({ op: "weekday" }).data({ date: [D(x)], return_type: [rt] }).result);
      for (const rt of [1, 2]) same(ev("WEEKNUM(x, rt)", { x: D(x), rt }), new WeekInfoNode({ op: "weeknum" }).data({ date: [D(x)], return_type: [rt] }).result);
      same(ev("ISOWEEKNUM(x)", { x: D(x) }), new WeekInfoNode({ op: "isoweeknum" }).data({ date: [D(x)] }).result);
      same(ev("WEEKDAY(x)", { x: D(x) }), new WeekInfoNode({ op: "weekday" }).data({ date: [D(x)] }).result); // default return_type 1
    }
    expect(ev("WEEKDAY(x)", { x: D(d("2026-03-15")) })).toBe(1);   // a Sunday
    expect(ev("ISOWEEKNUM(x)", { x: D(d("2021-01-03")) })).toBe(53); // ISO week of the prior year
  });
  it("YEARFRAC basis 1 is Excel's actual/actual, and the dates may come in either order", () => {
    const yf = (a: string, b: string, basis = 1) => ev("YEARFRAC(a, b, k)", { a: D(d(a)), b: D(d(b)), k: basis }) as number;
    expect(yf("2012-01-01", "2012-07-30")).toBeCloseTo(211 / 366, 12); // Excel's own example: a leap year has 366 days
    expect(yf("2023-07-01", "2024-03-01")).toBeCloseTo(244 / 366, 12); // under a year, 29 Feb 2024 inside
    expect(yf("2023-03-01", "2024-02-28")).toBeCloseTo(364 / 365, 12); // under a year, no 29 Feb inside
    expect(yf("2023-01-01", "2025-01-01")).toBeCloseTo(731 / (1096 / 3), 12); // over a year: the average of 2023–2025
    expect(yf("2012-07-30", "2012-01-01")).toBeCloseTo(211 / 366, 12);
    expect(yf("2024-07-01", "2024-01-01", 3)).toBeCloseTo(182 / 365, 12);
  });

  it("YEARFRAC truncates its dates to whole days, and a basis outside 0 to 4 is #DOMAIN!", () => {
    const [a, b] = [d("2024-01-01"), d("2024-01-02")];
    expect(ev("YEARFRAC(a, b, 3)", { a: D(a + 0.75), b: D(b + 0.5) })).toBeCloseTo(1 / 365, 12);
    expect((ev("YEARFRAC(a, b, 5)", { a: D(a), b: D(b) }) as { code: string }).code).toBe("#DOMAIN!");
    const card = new DateDiffNode({ op: "yearfrac" }).data({ start: [D(a)], end: [D(b)], basis: [-1] }).result;
    expect((card as { code: string }).code).toBe("#DOMAIN!");
  });

  it("YEARFRAC truncates its basis toward zero, as Excel truncates every argument", () => {
    const [a, b] = [d("2024-01-01"), d("2024-01-02")];
    expect(ev("YEARFRAC(a, b, -0.5)", { a: D(a), b: D(b) })).toBeCloseTo(ev("YEARFRAC(a, b, 0)", { a: D(a), b: D(b) }) as number, 12);
    expect(ev("YEARFRAC(a, b, 3.9)", { a: D(a), b: D(b) })).toBeCloseTo(1 / 365, 12);
    expect(new DateDiffNode({ op: "yearfrac" }).data({ start: [D(a)], end: [D(b)], basis: [-0.5] }).result).toBeCloseTo(1 / 360, 12);
  });

  it("US 30/360 counts a start on the last day of February as the 30th", () => {
    const d360 = (a: string, b: string) => ev("DAYS360(a, b)", { a: D(d(a)), b: D(d(b)) });
    expect(d360("2026-02-28", "2026-03-31")).toBe(30);
    expect(d360("2024-02-29", "2024-03-31")).toBe(30);
    expect(d360("2026-02-28", "2026-03-15")).toBe(15);
    expect(d360("2024-02-28", "2024-03-15")).toBe(17);   // not the last day in a leap year
    expect(d360("2026-02-28", "2027-02-28")).toBe(358);  // DAYS360 leaves an end in February alone
    expect(ev("DAYS360(a, b, TRUE)", { a: D(d("2026-02-28")), b: D(d("2026-03-31")) })).toBe(32);
    // YEARFRAC basis 0: [[formula-language#Date kernels]].
    const yf0 = (a: string, b: string) => (ev("YEARFRAC(a, b, 0)", { a: D(d(a)), b: D(d(b)) }) as number) * 360;
    expect(yf0("2026-02-28", "2027-02-28")).toBeCloseTo(360, 9);
    expect(yf0("2026-02-28", "2026-03-15")).toBeCloseTo(15, 9);
    expect(yf0("2026-02-28", "2026-03-31")).toBeCloseTo(31, 9);
    expect(yf0("2026-01-31", "2026-03-31")).toBeCloseTo(60, 9);
    expect(new DateDiffNode({ op: "days360" }).data({ start: [D(d("2026-02-28"))], end: [D(d("2026-03-31"))], basis: [0] }).result).toBe(30);
  });

  it("DAYS / DAYS360 / YEARFRAC / DATEDIF", () => {
    const s = d("2024-01-31"), z = d("2026-03-01");
    same(ev("DAYS(z, s)", { s: D(s), z: D(z) }), new DateDiffNode({ op: "days" }).data({ start: [D(s)], end: [D(z)] }).result);
    same(ev("DAYS(s, z)", { s: D(s), z: D(z) }), new DateDiffNode({ op: "days" }).data({ start: [D(z)], end: [D(s)] }).result); // signed
    for (const basis of [0, 1]) {
      same(ev("DAYS360(s, z, m)", { s: D(s), z: D(z), m: basis === 1 }), new DateDiffNode({ op: "days360" }).data({ start: [D(s)], end: [D(z)], basis: [basis] }).result);
    }
    for (const basis of [0, 1, 2, 3, 4]) {
      same(ev("YEARFRAC(s, z, b)", { s: D(s), z: D(z), b: basis }), new DateDiffNode({ op: "yearfrac" }).data({ start: [D(s)], end: [D(z)], basis: [basis] }).result);
    }
    const units: Array<[string, string]> = [["Y", "years"], ["M", "months"], ["D", "days"], ["YM", "ym"], ["MD", "md"], ["YD", "yd"]];
    for (const [unit, op] of units) {
      same(ev("DATEDIF(s, z, u)", { s: D(s), z: D(z), u: unit }), new DateDiffNode({ op: op as never }).data({ start: [D(s)], end: [D(z)] }).result);
    }
    expect(isSolError(ev("DATEDIF(z, s, \"Y\")", { s: D(s), z: D(z) }))).toBe(true);   // reversed range: #DOMAIN! (the node blanks the cell)
    expect(isSolError(ev("DATEDIF(s, z, \"Q\")", { s: D(s), z: D(z) }))).toBe(true);   // unknown unit
  });
});
