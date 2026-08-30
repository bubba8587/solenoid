import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { DateConstructNode, TimeConstructNode, DateTimeValueNode, WeekInfoNode, DateDiffNode } from "../../../src/graph/nodes/date";
import { parseDateToSerial } from "../../../src/graph/nodes/dateSerial";
import { isSolError } from "../../../src/graph/errorValue";

// capabilityParity / shareImpl for the DATE family (A1 backing flip): every formula here
// runs the dateOps kernel its node runs — agreement is structural, this guards a re-fork.
const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const d = (s: string) => parseDateToSerial(s);
const same = (a: unknown, b: unknown) => {
  if (isSolError(a) || isSolError(b)) expect(isSolError(a) && isSolError(b) && a.code === b.code, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(true);
  else expect(a).toEqual(b);
};

describe("date formulas == date nodes", () => {
  it("DATE keeps the node's LITERAL year (26 is the year 26) and #DOMAIN! outside 1–9999", () => {
    for (const [y, m, dd] of [[2026, 3, 15], [26, 1, 1], [2024, 14, 31], [0, 1, 1], [10000, 1, 1]]) {
      same(ev("DATE(y, m, d)", { y, m, d: dd }), new DateConstructNode().data({ year: [y], month: [m], day: [dd] }).result);
    }
    expect(ev("DATE(26, 1, 1)")).toBeLessThan(0); // pre-1900 serial, not 1926
    expect(ev("DATE(2026, 3, 15)")).toBe(d("2026-03-15"));
  });
  it("TIME wraps past 24 h like the node", () => {
    for (const [h, m, s] of [[12, 0, 0], [25, 30, 0], [0, 90, 0], [23, 59, 59.5]]) {
      same(ev("TIME(h, m, s)", { h, m, s }), new TimeConstructNode().data({ hour: [h], minute: [m], second: [s] }).result);
    }
    expect(ev("TIME(6, 0, 0)")).toBeCloseTo(0.25, 12);
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
    expect(ev("TIMEVALUE(\"14:30:00\")")).toBeCloseTo(0.6041666666666666, 12);
  });
  it("WEEKDAY / WEEKNUM / ISOWEEKNUM with every return_type", () => {
    const dates = [d("2026-01-01"), d("2026-03-15"), d("2024-12-30"), d("2021-01-03")];
    for (const x of dates) {
      for (const rt of [1, 2, 3]) same(ev("WEEKDAY(x, rt)", { x, rt }), new WeekInfoNode({ op: "weekday" }).data({ date: [x], return_type: [rt] }).result);
      for (const rt of [1, 2]) same(ev("WEEKNUM(x, rt)", { x, rt }), new WeekInfoNode({ op: "weeknum" }).data({ date: [x], return_type: [rt] }).result);
      same(ev("ISOWEEKNUM(x)", { x }), new WeekInfoNode({ op: "isoweeknum" }).data({ date: [x] }).result);
      same(ev("WEEKDAY(x)", { x }), new WeekInfoNode({ op: "weekday" }).data({ date: [x] }).result); // default return_type 1
    }
    expect(ev("WEEKDAY(x)", { x: d("2026-03-15") })).toBe(1);   // a Sunday
    expect(ev("ISOWEEKNUM(x)", { x: d("2021-01-03") })).toBe(53); // ISO week of the prior year
  });
  it("DAYS / DAYS360 / YEARFRAC / DATEDIF", () => {
    const s = d("2024-01-31"), z = d("2026-03-01");
    same(ev("DAYS(z, s)", { s, z }), new DateDiffNode({ op: "days" }).data({ start: [s], end: [z] }).result);
    same(ev("DAYS(s, z)", { s, z }), new DateDiffNode({ op: "days" }).data({ start: [z], end: [s] }).result); // signed
    for (const basis of [0, 1]) {
      same(ev("DAYS360(s, z, m)", { s, z, m: basis === 1 }), new DateDiffNode({ op: "days360" }).data({ start: [s], end: [z], basis: [basis] }).result);
    }
    for (const basis of [0, 1, 2, 3, 4]) {
      same(ev("YEARFRAC(s, z, b)", { s, z, b: basis }), new DateDiffNode({ op: "yearfrac" }).data({ start: [s], end: [z], basis: [basis] }).result);
    }
    const units: Array<[string, string]> = [["Y", "years"], ["M", "months"], ["D", "days"], ["YM", "ym"], ["MD", "md"], ["YD", "yd"]];
    for (const [unit, op] of units) {
      same(ev("DATEDIF(s, z, u)", { s, z, u: unit }), new DateDiffNode({ op: op as never }).data({ start: [s], end: [z] }).result);
    }
    expect(ev("DATEDIF(s, z, \"Y\")", { s, z })).toBe(2);
    expect(isSolError(ev("DATEDIF(z, s, \"Y\")", { s, z }))).toBe(true);   // reversed range: #DOMAIN! (the node blanks the cell)
    expect(isSolError(ev("DATEDIF(s, z, \"Q\")", { s, z }))).toBe(true);   // unknown unit
  });
});
