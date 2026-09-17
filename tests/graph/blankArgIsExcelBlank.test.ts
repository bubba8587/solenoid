// [[C80]]
import { describe, it, expect } from "vitest";
import { compileEvaluator, BLANK_ARG_TYPES } from "../../src/graph/excelFormula";
import { resolveExcelFunction } from "../../src/graph/excelFunctions";
import { isSolError } from "../../src/graph/errorValue";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);

describe("blankArgIsExcelBlank — a blank slot is Excel's typed blank, an omitted argument the default", () => {
  it("every declared function exists and each declared index is a real parameter", () => {
    for (const [name, types] of Object.entries(BLANK_ARG_TYPES)) {
      expect(resolveExcelFunction(name), name).not.toBeNull();
      for (const i of Object.keys(types)) expect(Number(i)).toBeGreaterThanOrEqual(0);
    }
  });

  it("TEXTJOIN: a blank ignore_empty is FALSE and keeps the empties; omitted is not possible (required)", () => {
    expect(ev('TEXTJOIN(",", , "a", "", "b")')).toBe("a,,b");
    expect(ev('TEXTJOIN(",", TRUE, "a", "", "b")')).toBe("a,b");
    expect(ev('TEXTJOIN(",", FALSE, "a", "", "b")')).toBe("a,,b");
  });

  it("the Formula.js lookup candidates (MATCH / VLOOKUP / HLOOKUP) are blocked spellings, so no row is needed", () => {
    for (const expr of ["MATCH(30, x, )", "VLOOKUP(2, x, 1, )", "HLOOKUP(2, x, 1, )"]) {
      const r = ev(expr, { x: [10, 20, 30] });
      expect(isSolError(r) && r.code, expr).toBe("#NAME?");
    }
  });

  it("XMATCH / XLOOKUP: a blank match_mode is 0 (exact, the default); a blank search_mode is 0, which Excel rejects", () => {
    const x = [5, 7, 9];
    expect(ev("XMATCH(7, x, )", { x })).toBe(2);
    expect(ev("XMATCH(7, x)", { x })).toBe(2);
    expect(isSolError(ev("XMATCH(7, x, 0, )", { x }))).toBe(true);
    expect(ev("XLOOKUP(7, x, y, , )", { x, y: ["a", "b", "c"] })).toBe("b");
    expect(isSolError(ev("XLOOKUP(7, x, y, , 0, )", { x, y: ["a", "b", "c"] }))).toBe(true);
  });

  it("an undeclared blank still propagates as missing, never a fabricated 0", () => {
    expect(ev("SQRT()")).not.toBe(0);
    expect(ev("ROUND(2.5, )")).toBe(3); // ROUND already reads a blank as 0 (kept)
  });
});
