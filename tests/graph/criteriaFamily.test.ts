import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { criteriaAggregate, parseCriterion, criterionMatches } from "../../src/graph/excelCriteria";
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
  it("a date-shaped text criterion reads as a serial against a date column", () => {
    const d = [MON, MON + 1, MON + 2];
    expect(ev("SUMIFS(a, d, \">2026-01-06\")", { a, d })).toBe(5);
    expect(ev("SUMIFS(a, d, \">=2026-01-06\")", { a, d })).toBe(25);
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
  it("a blank criterion matches blank cells; a number matches numbers (numeric text too); errors never match", () => {
    expect(criteriaAggregate("count", null, [[["x", null, ""], null]])).toBe(2);
    expect(criteriaAggregate("count", null, [[["x", null, ""], "<>"]])).toBe(1);
    expect(criteriaAggregate("sum", [1, 2, 3], [[[5, "5", 5], 5]])).toBe(6); // numeric text matches a number (Excel COUNTIF)
    expect(criteriaAggregate("sum", [1, 2, 3], [[[5, "five", true], 5]])).toBe(1);
    expect(criteriaAggregate("count", null, [[[{ __solError: true, code: "#N/A", message: "" }, 1], 1]])).toBe(1);
    const amb = parseCriterion(">1/2/2026", true);
    expect(isSolError(amb) && amb.code).toBe("#AMBIGUOUS!");
    expect(criterionMatches(3, { op: "gte", value: 3 })).toBe(true);
  });
  it("the card and the formula agree on one probe", () => {
    const f = buildFrame([["North", 120], ["South", 80], ["North", 200]] as never, ["region", "sales"]);
    const card = new SumIfsNode({ op: "sumifs", valueKeys: ["column0", "value0"], condConfig: { "0": { op: "gt" } } });
    card.stringLiterals.values = "sales"; card.stringLiterals.column0 = "sales"; card.stringLiterals.value0 = "100";
    expect(card.data({ frame: [f] }).result).toBe(ev("SUMIFS(s, s, \">100\")", { s: [120, 80, 200] }));
  });
});

describe("numeric text in the ranges (the SUMIF failure mode formulajs had)", () => {
  it("compares numerically in the criteria range and contributes its number in the value range", () => {
    expect(ev('COUNTIF(v, ">15")', { v: ["10", "30", "20"] })).toBe(2);
    expect(ev('AVERAGEIF(k, "a", v)', { k: ["a", "a", "b"], v: ["10", "30", "20"] })).toBe(20);
    expect(ev('SUMIFS(v, k, "a")', { k: ["a", "a", "b"], v: ["10", "x", "20"] })).toBe(10);
  });
});
