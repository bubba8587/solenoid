// [[C80]]
import { describe, it, expect } from "vitest";
import { compileEvaluator, BLANK_ARG_TYPES } from "../../src/graph/excelFormula";
import { resolveExcelFunction } from "../../src/graph/excelFunctions";
import { isSolError } from "../../src/graph/errorValue";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);

describe("[[C80]] blankArgIsExcelBlank — a blank slot is Excel's typed blank, an omitted argument the default", () => {
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

  it("a blank VALUE into a scalar call is a blank answer; an empty slot is still the function's to read ([[D36]] nullSkippedNotZero)", () => {
    expect(ev("ABS(x)", { x: null })).toBeNull();
    expect(ev("NOT(x)", { x: null })).toBeNull();
    expect(ev("ROUND(x, 1)", { x: null })).toBeNull();
    expect(ev("ISBLANK(x)", { x: null })).toBe(true); // a blank-inspecting function sees it
    expect(ev("ROUND(2.5, )")).toBe(3);                 // the empty slot is not a value
  });

  it("INDEX: a blank position is 0, the whole axis; a blank value still blanks the answer", () => {
    const m = [[1, 2], [3, 4]];
    expect(ev("INDEX(x, , 2)", { x: [10, 20, 30] })).toBe(20);
    expect(ev("INDEX(m, , 2)", { m })).toEqual([2, 4]);
    expect(ev("INDEX(m, 2, )", { m })).toEqual([3, 4]);
    expect(ev("INDEX(m, b, 2)", { m, b: null })).toBeNull();
  });

  it("EXPAND, TAKE, DROP: a blank size keeps that axis, as omitted; a blank value blanks the answer", () => {
    const m = [[1, 2], [3, 4]];
    expect(ev("EXPAND(m, 3, , 0)", { m })).toEqual([[1, 2], [3, 4], [0, 0]]);
    expect(ev("EXPAND(m, , 3)", { m })).toEqual([[1, 2, null], [3, 4, null]]);
    expect(ev("TAKE(m, , 1)", { m })).toEqual([[1], [3]]);
    expect(ev("DROP(m, , 1)", { m })).toEqual([[2], [4]]);
    for (const f of ["EXPAND(m, b, 3)", "TAKE(m, b, 1)", "DROP(m, b, 1)"]) expect(ev(f, { m, b: null }), f).toBeNull();
  });

  it("an undeclared blank still propagates as missing, never a fabricated 0", () => {
    expect(ev("SQRT()")).not.toBe(0);
  });
});
