// [[C131]] noTextGuessing, [[B17]] typedValueModel
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";

const ev = (src: string, vars: Record<string, unknown> = {}) => compileEvaluator(src)!(vars);
const code = (v: unknown) => (isSolError(v) ? v.code : v);
const x = [1, "5", 3];

describe("a formula never reads a number, date or logical out of text ([[C131]] noTextGuessing)", () => {
  it("an operator on text is #VALUE!", () => {
    for (const src of ['-"5"', '+"5"', '"5"%', '"5" + 1']) expect(code(ev(src))).toBe("#VALUE!");
    expect(ev('5 = "5"')).toBe(false);
  });

  it("a function that needs a number answers #VALUE! for numeric text", () => {
    for (const src of ['ABS("5")', 'ROUND("2.5", 0)', 'SQRT("4")', 'DATE("2024", 1, 1)', 'REPT("a", "3")', 'LEFT("abc", "2")', 'PMT("0.1", 2, 100)'])
      expect(code(ev(src))).toBe("#VALUE!");
    expect(ev('SQRT("4")')).toMatchObject({ message: "SQRT needs a number" });
    expect(code(ev('INDEX(x, "2")', { x }))).toBe("#VALUE!");
  });

  it("a date function never reads date text", () => {
    for (const src of ['EDATE("2024-01-31", 1)', 'YEAR("2024-01-01")', 'YEARFRAC("2024-01-01", "2024-06-01")', 'WORKDAY("2024-01-01", 5)'])
      expect(code(ev(src))).toBe("#VALUE!");
  });

  it("a condition or a TRUE/FALSE argument never reads the text TRUE", () => {
    expect(code(ev('IF("TRUE", 1, 2)'))).toBe("#VALUE!");
    expect(code(ev('UNIQUE(x, "TRUE")', { x }))).toBe("#VALUE!");
    expect(code(ev('XNOR("TRUE", TRUE)'))).toBe("#TYPE!");
  });

  it("an aggregate that skips non-numbers skips numeric text", () => {
    expect(ev("SUM(x)", { x })).toBe(4);
    expect(ev('SUM(1, "5")')).toBe(1);
    expect(ev("AVERAGE(x)", { x })).toBe(2);
    expect(ev("MEDIAN(x)", { x })).toBe(2);
    expect(ev("LARGE(x, 1)", { x })).toBe(3);
    expect(ev("COUNT(x)", { x })).toBe(2);
  });

  it("INTERPOLATE and the regressions name the list that holds text", () => {
    expect(ev("INTERPOLATE(x, y, 2)", { x, y: [1, 2, 4] })).toMatchObject({ code: "#VALUE!", message: "INTERPOLATE: known_ys need numbers" });
    expect(ev('INTERPOLATE(y, y, "2")', { y: [1, 2, 4] })).toMatchObject({ code: "#VALUE!", message: "INTERPOLATE: new_xs need numbers" });
    expect(ev("TREND(x)", { x })).toMatchObject({ code: "#VALUE!", message: "Known Ys need numbers" });
  });

  it("DIAGONAL and GEOMETRIC refuse a text cell", () => {
    expect(ev("DIAGONAL(x)", { x: [1, "5"] })).toMatchObject({ code: "#VALUE!", message: "DIAGONAL needs numbers" });
    expect(ev('GEOMETRIC("1", 2, 3)')).toMatchObject({ code: "#VALUE!", message: "GEOMETRIC needs a number" });
  });

  it("ACCRINT reads its dates as serials, as every date argument does, and never date text", () => {
    expect(ev("ACCRINT(39508, 39691, 39569, 0.1, 1000, 2, 0)") as number).toBeCloseTo(16.666667, 6); // Excel's example
    expect(code(ev('ACCRINT("2008-03-01", 39691, 39569, 0.1, 1000, 2, 0)'))).toBe("#VALUE!");
  });

  it("TEXT formats a number and leaves text as it is", () => {
    expect(ev('TEXT("5", "0.00")')).toBe("5");
    expect(ev('TEXT(5, "0.00")')).toBe("5.00");
  });

  it("the explicit converters read text, as a typed input does", () => {
    expect(ev('VALUE("5")')).toBe(5);
    expect(ev('NUMBERVALUE("1.234,5", ",", ".")')).toBe(1234.5);
    expect(ev('DATEVALUE("2024-01-01")')).toBe(45292);
    expect(ev('TIMEVALUE("12:00")')).toBe(0.5);
    expect(ev('BIN2DEC("101")')).toBe(5);
  });
});
