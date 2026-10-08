// [[C14]] currentExcelParity, [[C80]] blankArgIsExcelBlank, [[D70]] nullNotEnoughData
// Answers the author read off real Excel on 2026-10-05 (the parity sheet). Solenoid's #DOMAIN! is Excel's #NUM!.
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";

const L5 = { a: [1, 2, 3, 4, 5] };
const CHECKED: [string, unknown, Record<string, unknown>?][] = [
  ["POWER(2, )", 1], ["IF(TRUE, , 5)", 0], ["AVERAGE(2, )", 1], ["MOD(5, )", "#DIV/0!"], ['CONCAT("a", , "b")', "ab"],
  ['TEXTJOIN(",", , "a", "", "b")', "a,b"], ["ROUND(2.5, )", 3],
  ["XLOOKUP(9, a, b, )", "#N/A", { a: [1, 2, 3], b: [10, 20, 30] }],
  ["CUMIPMT(0.01, 12, 1000, 1, 15, 0)", "#DOMAIN!"], ["CUMPRINC(0.01, 12, 1000, 1, 15, 0)", "#DOMAIN!"],
  ["COUPPCD(DATE(2024,3,15), DATE(2026,8,31), 2, 0)", "DATE(2024,2,29)"],
  ["COUPNCD(DATE(2024,1,15), DATE(2026,8,31), 2, 0)", "DATE(2024,2,29)"],
  ["SYD(10000, 1000, 5, 7)", "#DOMAIN!"], ["SLN(1, 1, 0)", "#DIV/0!"],
  ["DAYS360(DATE(2024,1,31), DATE(2024,3,1))", 31], ["DAYS360(DATE(2024,2,29), DATE(2024,3,31))", 30],
  ["DAYS360(DATE(2023,2,28), DATE(2023,3,31))", 30], ["YEARFRAC(DATE(2023,2,28), DATE(2024,2,29), 0)", 1],
  ["YEARFRAC(DATE(2024,2,29), DATE(2025,2,28), 0)", 1],
  ["LARGE(a, 2.5)", 3, L5], ["SMALL(a, 2.5)", 2, L5], ["PERCENTRANK.EXC(a, 5)", 1, { a: [5] }],
  ["LOGEST(a)", "#DOMAIN!", { a: [1, -1, 2, 3] }], ["GROWTH(a)", "#DOMAIN!", { a: [1, -1, 2, 3] }],
  ["NORM.DIST(1, 0, -1, TRUE)", "#DOMAIN!"], ["CHISQ.DIST(0, 1, FALSE)", "#DOMAIN!"],
  ["RANDARRAY(1, 1, 1.2, 1.8, TRUE)", "#VALUE!"],
];

describe("answers checked in Excel", () => {
  it("every one matches", () => {
    const ev = (src: string, env: Record<string, unknown> = {}) => compileEvaluator(src)!(env);
    const off: string[] = [];
    for (const [src, want, env] of CHECKED) {
      const got = ev(src, env);
      const shown = got && typeof got === "object" && "__solError" in got ? (got as unknown as { code: string }).code : got;
      const expected = typeof want === "string" && want.startsWith("DATE(") ? ev(want) : want;
      if (JSON.stringify(shown) !== JSON.stringify(expected)) off.push(`${src}: ${JSON.stringify(shown)}, Excel ${JSON.stringify(expected)}`);
    }
    expect(off).toEqual([]);
  });
  it("TEXTSPLIT with a row delimiter alone answers one column", () => {
    expect(compileEvaluator('TEXTSPLIT("a;b", , ";")')!({})).toEqual([["a"], ["b"]]);
    expect((compileEvaluator('TEXTSPLIT("a;b", , )')!({}) as { code?: string }).code).toBe("#SYNTAX!");
  });
});
