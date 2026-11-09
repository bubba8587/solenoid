// [[C45]] excelComparisons, [[C24]] arraySemantics, [[B11]] maximalMerge, [[D123]] typedCriteria, [[formula-language#Criteria]]
import { describe, it, expect } from "vitest";
import { solDate } from "../../src/graph/dateValue";
import type { FrameValue } from "../../src/graph/frame";
import type { FilterOp } from "../../src/graph/frameOps";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";
import { SumIfsNode } from "../../src/graph/nodes/list";
import { buildFrame } from "../../src/graph/frame";

const ev = (src: string, vars: Record<string, unknown>) => compileEvaluator(src)!(vars);
const n = ["apple", "banana", "apricot"], a = [10, 20, 5];
const MON = 46027; // 2026-01-05

describe("the *IFS family runs Excel's criteria grammar", () => {
  it("wildcards, the ~ escape, comparisons and <> on text", () => {
    expect(ev("SUMIFS(a, n, \"ap*\")", { a, n })).toBe(15);
    expect(ev("SUMIFS(a, n, \"ap?le\")", { a, n })).toBe(10);
    expect(ev("SUMIFS(a, n, \"ap~*\")", { a, n })).toBe(0);
    expect(ev("SUMIFS(a, n, \"<>banana\")", { a, n })).toBe(15);
    expect(ev("SUMIFS(a, n, \"APPLE\")", { a, n })).toBe(10); // folded case, like Excel
    expect(ev("SUMIFS(a, a, \">6\")", { a })).toBe(30);
  });
  it("a date-shaped text criterion over numbers is text, never a serial", () => {
    const d = [MON, MON + 1, MON + 2];
    expect(ev("SUMIFS(a, d, \">2026-01-06\")", { a, d })).toBe(0);
    expect(ev("SUMIFS(a, d, \">46027\")", { a, d })).toBe(25);
  });
  it("COUNTIFS, AVERAGEIFS, MINIFS, MAXIFS, COUNTIF, AVERAGEIF", () => {
    expect(ev("COUNTIFS(n, \"*a*\", a, \">5\")", { a, n })).toBe(2);
    expect(ev("AVERAGEIFS(a, n, \"ap*\")", { a, n })).toBe(7.5);
    expect(ev("MINIFS(a, n, \"ap*\")", { a, n })).toBe(5);
    expect(ev("MAXIFS(a, n, \"<>apple\")", { a, n })).toBe(20);
    expect(ev("COUNTIF(n, \"ap*\")", { n })).toBe(2);
    expect(ev("AVERAGEIF(a, \">6\")", { a })).toBe(15);
    expect(ev("AVERAGEIF(n, \"ap*\", a)", { a, n })).toBe(7.5);
  });
  it("a blank criterion matches blank cells; a number matches only numbers; errors never match", () => {
    expect(ev("COUNTIFS(r, c)", { r: ["x", null, ""], c: null })).toBe(2);
    expect(ev("COUNTIFS(r, c)", { r: ["x", null, ""], c: "<>" })).toBe(1);
    expect(ev("SUMIFS(s, r, 5)", { s: [1, 2, 3], r: [5, "5", 5] })).toBe(4); // text "5" is text, never the number 5 ([[B17]] typedValueModel)
    expect(ev("SUMIFS(s, r, 5)", { s: [1, 2, 3], r: [5, "five", true] })).toBe(1);
    expect(ev("COUNTIFS(r, 1)", { r: [{ __solError: true, code: "#N/A", message: "" }, 1] })).toBe(1);
    const amb = ev("COUNTIFS(r, \">1/2/2026\")", { r: [solDate(MON)] });
    expect(isSolError(amb) && amb.code).toBe("#TYPE!");
  });
  it("the card and the formula agree on one probe", () => {
    const f = buildFrame([["North", 120], ["South", 80], ["North", 200]] as never, ["region", "sales"]);
    const card = new SumIfsNode({ op: "sumifs", valueKeys: ["column0", "value0"], condConfig: { "0": { op: "gt" } } });
    card.stringLiterals.values = "sales"; card.stringLiterals.column0 = "sales"; card.stringLiterals.value0 = "100";
    expect(card.data({ frame: [f] }).result).toBe(ev("SUMIFS(s, s, \">100\")", { s: [120, 80, 200] }));
  });
});

describe("numeric text in the ranges stays text ([[B17]] typedValueModel)", () => {
  it("never adds to a sum or an average, and never meets a number criterion", () => {
    expect(ev('SUMIFS(v, k, "a")', { k: ["a", "a", "b"], v: ["10", 5, "20"] })).toBe(5);
    expect(ev('AVERAGEIF(k, "a", v)', { k: ["a", "a", "b"], v: ["10", "30", "20"] })).toBeNull(); // no numbers: blank, as AVERAGE
    expect(ev("COUNTIF(v, 20)", { v: ["20", 20, "20"] })).toBe(1);
  });
  it("a number ordering over a range holding text is #TYPE!, never an alphabetical match", () => {
    const code = (v: unknown) => (v as { code?: string }).code;
    expect(code(ev('COUNTIF(v, ">15")', { v: ["9", "10", "20"] }))).toBe("#TYPE!");
    expect(code(ev('SUMIFS(n, v, "<=2")', { v: [1, "2", 3], n: [1, 1, 1] }))).toBe("#TYPE!");
    expect(ev('COUNTIF(v, ">b")', { v: ["a", "c"] })).toBe(1);
    expect(ev('COUNTIF(v, "<>15")', { v: ["9", "15"] })).toBe(1);
  });
  it("a typed criterion over a text range is text, so it matches the same text", () => {
    expect(ev('COUNTIF(ids, "10")', { ids: ["10", "20", "10"] })).toBe(2);
    expect(ev('COUNTIF(ids, 10)', { ids: ["10", "20", "10"] })).toBe(0);
  });
});

describe("a criterion is an operator and a typed value ([[D123]] typedCriteria)", () => {
  const d = [solDate(MON), solDate(MON + 1), solDate(MON + 2)];
  const code = (v: unknown) => (isSolError(v) ? v.code : v);
  const msg = (v: unknown) => (isSolError(v) ? v.message : "");
  it("an operator joined to a date reads as that operator and the date", () => {
    expect(ev("SUMIFS(a, d, \">\"&DATE(2026,1,5))", { a, d })).toBe(25);
    expect(ev("SUMIFS(a, d, \">=\"&DATE(2026,1,6))", { a, d })).toBe(25);
    expect(ev("COUNTIFS(d, \"<>\"&DATE(2026,1,6))", { d })).toBe(2);
    expect(ev("SUMIFS(a, d, DATE(2026,1,6))", { a, d })).toBe(20);
    expect(ev("AVERAGEIF(d, \">\"&DATE(2026,1,5))", { d })).toEqual(solDate(MON + 1.5));
  });
  it("and to a wired name holding a date, item by item over a list", () => {
    expect(ev("SUMIFS(a, d, \"<=\"&cutoff)", { a, d, cutoff: solDate(MON + 1) })).toBe(30);
    expect(ev("COUNTIF(d, \"<=\"&d)", { d })).toEqual([1, 2, 3]);
  });
  it("criterion text is never read as a date or a serial against dates: #TYPE! names the joined form", () => {
    const shaped = ev("SUMIFS(a, d, \">=2026-01-06\")", { a, d });
    expect(code(shaped)).toBe("#TYPE!");
    expect(msg(shaped)).toContain("\">=\"&DATE(2026,1,6)");
    expect(msg(shaped)).toContain("join \">=\" to a name holding a date");
    const serial = ev("COUNTIF(d, \">46027\")", { d });
    expect(code(serial)).toBe("#TYPE!");
    expect(msg(serial)).toContain("\">\"&DATE(year, month, day)");
    expect(code(ev("COUNTIF(d, 46027)", { d }))).toBe("#TYPE!");
    expect(code(ev("COUNTIF(d, \">\"&cutoff)", { d, cutoff: "2026-01-06" }))).toBe("#TYPE!");
  });
  it("a date criterion over numbers is #TYPE!; numbers and text keep Excel's grammar", () => {
    expect(code(ev("COUNTIF(a, \">\"&DATE(2026,1,1))", { a }))).toBe("#TYPE!");
    expect(ev("SUMIFS(a, a, \">\"&6)", { a })).toBe(30);
    expect(ev("SUMIFS(a, n, \"<>\"&\"ban*\")", { a, n })).toBe(15);
    expect(ev("COUNTIF(n, \"=\"&x)", { n, x: null })).toBe(0);
  });
  it("the SUMIFS card and its formula match through one kernel, dates and blanks included", () => {
    const f: FrameValue = { __frame: true, columns: [
      { name: "rep", type: "string", values: ["Ada", "", "ada", "Bo"] },
      { name: "due", type: "date", values: [MON, MON + 1, MON + 2, MON + 3] },
      { name: "amt", type: "number", values: [10, 20, 5, 7] },
    ] };
    const rep = ["Ada", "", "ada", "Bo"], due = [MON, MON + 1, MON + 2, MON + 3].map(solDate), amt = [10, 20, 5, 7];
    const card = (op: FilterOp, column: string, value: unknown, typed?: string) => {
      const n = new SumIfsNode({ op: "sumifs", valueKeys: ["column0", "value0"], condConfig: { "0": { op } } });
      n.stringLiterals.values = "amt"; n.stringLiterals.column0 = column;
      if (typed !== undefined) n.stringLiterals.value0 = typed;
      return n.data({ frame: [f], ...(value === undefined ? {} : { value0: [value] }) }).result;
    };
    const vars = { rep, due, amt };
    expect(card("gte", "due", solDate(MON + 1))).toBe(ev("SUMIFS(amt, due, \">=\"&DATE(2026,1,6))", vars));
    expect(card("gte", "due", undefined, "2026-01-06")).toBe(32);
    expect(code(card("gte", "due", "2026-01-06"))).toBe(code(ev("SUMIFS(amt, due, \">=\"&\"2026-01-06\")", vars)));
    expect(card("eq", "rep", undefined, "ADA")).toBe(ev("SUMIFS(amt, rep, \"ADA\")", vars));
    expect(card("neq", "rep", undefined, "Ada")).toBe(ev("SUMIFS(amt, rep, \"<>Ada\")", vars));
    expect(card("eq", "rep", undefined, "a*")).toBe(ev("SUMIFS(amt, rep, \"a*\")", vars));
    expect(card("isblank", "rep", undefined)).toBe(ev("SUMIFS(amt, rep, \"=\")", vars));
    expect(card("notblank", "rep", undefined)).toBe(ev("SUMIFS(amt, rep, \"<>\")", vars));
    expect(card("gt", "amt", undefined, "6")).toBe(ev("SUMIFS(amt, amt, \">6\")", vars));
  });
});
