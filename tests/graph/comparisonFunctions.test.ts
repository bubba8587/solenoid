// [[formula-language#Scalar operators]], [[C45]] excelComparisons, [[C17]] shareImpl, [[formula-language#Scalar operators]]
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { BetweenNode, ComparisonNode, type ComparisonOp } from "../../src/graph/nodes/logic";
import { solDate } from "../../src/graph/dateValue";
import { isSolError } from "../../src/graph/errorValue";
import type { UnitCell } from "../../src/graph/unitValue";

const ev = (src: string, vars: Record<string, unknown> = {}) => compileEvaluator(src)!(vars);
const code = (v: unknown): unknown => (Array.isArray(v) ? v.map(code) : isSolError(v) ? v.code : v);
const FX: Record<ComparisonOp, { fn: string; sym: string }> = {
  eq: { fn: "IS", sym: "=" }, neq: { fn: "ISNOT", sym: "<>" }, gt: { fn: "ABOVE", sym: ">" },
  lt: { fn: "BELOW", sym: "<" }, gte: { fn: "ATLEAST", sym: ">=" }, lte: { fn: "ATMOST", sym: "<=" },
};
const card = (op: ComparisonOp, a: unknown, b: unknown) => new ComparisonNode({ op }).data({ a: [a], b: [b] }).result;
const km = (n: number): UnitCell => ({ __unitCell: true, value: n * 1000, dim: { length: 1 }, display: "km" });
const sec = (n: number): UnitCell => ({ __unitCell: true, value: n, dim: { time: 1 }, display: "s" });

describe("each Comparison op is its function, and the function answers as its operator", () => {
  const probes: [string, unknown, unknown][] = [
    ["numbers", [1, 2, 3], 2],
    ["near-equal numbers", 0.30000000000000004, 0.3],
    ["dates", [solDate(46023), solDate(46024)], solDate(46023)],
    ["a date against a number", solDate(46023), 46023],
    ["text in any case", ["apple", "Apple", "pear"], "APPLE"],
    ["text against a number", "5", 5],
    ["a logical as 0 or 1", true, 1],
  ];
  for (const op of Object.keys(FX) as ComparisonOp[]) {
    it.each(probes)(`${FX[op].fn} on %s`, (_, a, b) => {
      const fn = ev(`${FX[op].fn}(a, b)`, { a, b });
      expect(code(card(op, a, b))).toEqual(code(fn));
      const operator = ev(`a ${FX[op].sym} b`, { a, b });
      expect(code(fn)).toEqual(code(operator));
    });
  }
  it("text equality ignores case and ordering goes by character code", () => {
    expect(ev('IS("Apple", "APPLE")')).toBe(true);
    expect(ev('ISNOT("Apple", "APPLE")')).toBe(false);
    expect(ev('BELOW("B", "a")')).toBe(true);
  });
});

// A formula reads units only through the unit-aware Expression; the kernel's unit rules are pinned on the card here and
// on the function in `compare.rs`'s tests.
describe("the Comparison card's rules for units and blanks", () => {
  it("a plain number beside a unit value reads in its display unit", () => {
    expect(card("gt", km(5), 3)).toBe(true);
    expect(card("eq", km(2), km(2))).toBe(true);
  });
  it("different dimensions are unequal and unordered", () => {
    expect(card("eq", km(1), sec(1))).toBe(false);
    expect(card("neq", km(1), sec(1))).toBe(true);
    expect(code(card("gt", km(1), sec(1)))).toBe("#UNIT!");
  });
  it("a blank answers blank, item by item", () => {
    expect(card("gt", null, 2)).toBe(null);
    expect(ev("ABOVE(a, 2)", { a: null })).toBe(null);
    expect(ev("ABOVE(a, 2)", { a: [3, null, 1] })).toEqual([true, null, false]);
    expect(new ComparisonNode({ op: "gt" }).data({ a: [[3, null, 1]], b: [2] }).result).toEqual([true, null, false]);
    expect(ev("a > 2", { a: [3, null, 1] })).toEqual([true, null, false]);
  });
});

describe("BETWEEN(values, low, high) is the Between card", () => {
  const between = (value: unknown, lo: unknown, hi: unknown) => new BetweenNode().data({ value: [value], lo: [lo], hi: [hi] }).result;
  it("over a list, inclusive at both ends", () => {
    expect(ev("BETWEEN(v, 2, 3)", { v: [1, 2, 3, 4] })).toEqual([false, true, true, false]);
    expect(between([1, 2, 3, 4], 2, 3)).toEqual([false, true, true, false]);
  });
  it("dates between dates, a blank item blank, a mismatch #TYPE!", () => {
    const d = [solDate(46023), solDate(46030)];
    expect(ev("BETWEEN(d, DATE(2026,1,1), DATE(2026,1,5))", { d })).toEqual([true, false]);
    expect(code(ev("BETWEEN(v, 1, 3)", { v: [2, null, "x"] }))).toEqual([true, null, "#TYPE!"]);
    expect(code(between([2, null, "x"], 1, 3))).toEqual([true, null, "#TYPE!"]);
  });
});

describe("an unwired Comparison or Between slot is read as the kind its button shows", () => {
  it("keyed Text, Date and Number compare as their kinds, and nothing keyed reads its Fallback, 0 ([[D96]] emptySlotShowsItsValue)", () => {
    const cmp = new ComparisonNode({ op: "eq" });
    cmp.stringLiterals = { b: "APPLE" };
    cmp.literalKinds = { b: "string" };
    expect(cmp.data({ a: [["apple", "pear"]] }).result).toEqual([true, false]);
    cmp.literalKinds = {};
    expect(code(cmp.data({ a: ["apple"] }).result)).toBe("#TYPE!");
    cmp.stringLiterals = {};
    expect(cmp.data({ a: [5] }).result).toBe(false);
    expect(cmp.data({ a: [0] }).result).toBe(true);
    const btw = new BetweenNode();
    btw.stringLiterals = { lo: "01-Jan-2026", hi: "31-Jan-2026" };
    btw.literalKinds = { lo: "date", hi: "date" };
    expect(btw.data({ value: [[solDate(46030), solDate(46060)]] }).result).toEqual([true, false]);
  });
});
