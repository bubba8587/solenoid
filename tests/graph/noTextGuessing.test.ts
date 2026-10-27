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

  it("a paired-list function drops a text pair as it drops a blank one, keeping the lists in step", () => {
    const L = [1, "2", 3, 2], N = [1, 2, 3, 4];
    const blank = { L: [1, null, 3, 2], N };
    for (const fn of ["SLOPE", "INTERCEPT", "CORREL", "RSQ", "COVARIANCE.S", "SPEARMAN"])
      expect(ev(`${fn}(L, N)`, { L, N })).toBeCloseTo(ev(`${fn}(L, N)`, blank) as number, 12);
    expect(ev("SLOPE(L, N)", { L, N })).toBeCloseTo(3 / 7, 12);
  });

  it("a pack or coupon function refuses numeric text where it read blank or #DOMAIN!", () => {
    for (const src of ['SUNRISE(45292, "51.5", 0)', 'AWGWIRE("12")', 'COLEBROOK("1e5", 0.001)', 'STANDARDATMOSPHERE("1000")',
      'TRIANGLESOLVER(2, 2, "2")', 'ANTOINE("water", "100")', 'COUPDAYS(45292, 45658, 2, "1")',
      'ACCRINT(45292, 45474, 45658, "0.1", 1000, 2, 0)'])
      expect(code(ev(src))).toBe("#VALUE!");
    expect(code(ev('ANTOINE("water", 100)'))).not.toBe("#VALUE!");
  });

  it("a dated cash flow or a signal refuses a text cell, as NPV does, where it read 0; IRR and MIRR skip it as Excel does", () => {
    const flows = [-100, "60", 60];
    for (const src of ["XNPV(0.1, f, d)", "XIRR(f, d)", "CONVOLVE(f, f)", "SPECTRUM(f)", "NPV(0.1, f)"])
      expect(code(ev(src, { f: flows, d: [45292, 45658, 46023] }))).toBe("#VALUE!");
    expect(ev("IRR(f)", { f: flows })).toBeCloseTo(-0.4, 12);
    expect(code(ev("IRR(f)", { f: [-100, null, 120] }))).not.toBe("#VALUE!");
  });

  it("TRIMMEAN and FORECAST.LINEAR refuse text with #VALUE!, not #DOMAIN!", () => {
    const L = [1, "2", 3, 2], N = [1, 2, 3, 4];
    expect(code(ev("TRIMMEAN(L, 0.2)", { L: [1, "2", 3, 4, 5] }))).toBe("#VALUE!");
    expect(code(ev('TRIMMEAN("12345", 0.2)'))).toBe("#VALUE!");
    expect(code(ev("FORECAST.LINEAR(5, L, N)", { L, N }))).toBe("#VALUE!");
    expect(ev("TRIMMEAN(N, 0.2)", { N })).toBe(2.5);
  });

  it("number slots the second sweep found refuse text with #VALUE!", () => {
    const r = [0.1, -0.05, 0.2], c = [-100, 60, 60], d = [45292, 45658, 46023];
    for (const [src, vars] of [
      ['CAGR(r, "1")', { r }], ['SHARPE(r, "0.01")', { r }], ['T.TEST(r, r, "2", 1)', { r }], ['HYPOTENUSE("3", 4)', {}],
      ['LOG2("8")', {}], ['PPMT(0.1, "1", 3, 100)', {}], ['FUZZYMATCH("abc", t, "0.9")', { t: ["abc"] }],
      ["WAVG(v, w)", { v: [1, "2"], w: [1, 1] }], ['IRR(c, "0.1")', { c }], ["XIRR(c, x)", { c, x: [45292, "45658", 46023] }],
      ['XNPV("0.1", c, d)', { c, d }], ['GCD("12", 18)', {}], ['MULTINOMIAL("2", 3)', {}], ['TEXTSPLIT("a,b", ",", , , "1")', {}],
    ] as [string, Record<string, unknown>][])
      expect(code(ev(src, vars)), src).toBe("#VALUE!");
    expect(ev("GCD(12, 18)")).toBe(6);
  });
});

