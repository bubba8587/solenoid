// [[A5]] excelParity, [[formula-language#LET]]
import { describe, it, expect } from "vitest";
import { compileEvaluator, extractVariables, formulaToLatex } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";

const ev = (e: string, env: Record<string, unknown> = {}) => compileEvaluator(e)!(env);

describe("LET names a value inside a formula", () => {
  it("binds one name or several, each later value reading the names before it", () => {
    expect(ev("LET(a, 2, a * 3)")).toBe(6);
    expect(ev("LET(a, 2, b, a + 1, a * b)")).toBe(6);
    expect(ev("let(total, SUM(v), total / COUNT(v))", { v: [1, 2, 3] })).toBe(2);
    expect(ev("LET(a, k, a * 3)", { k: [1, 2] })).toEqual([3, 6]);
  });

  it("a LET name is no input: only the names it leaves free are variables", () => {
    expect(extractVariables("LET(a, k, b, a + 1, a * b) + x")).toEqual(["k", "x"]);
  });

  it("an inner LET shadows an outer name, and a name can hold a LAMBDA", () => {
    expect(ev("LET(a, 2, LET(a, 3, a) + a)")).toBe(5);
    expect(ev("LET(f, LAMBDA(q, q * q), f(4))")).toBe(16);
    expect(ev("MAP(v, LAMBDA(x, LET(y, x * 2, y + 1)))", { v: [1, 2, 3] })).toEqual([3, 5, 7]);
  });

  it("a value the calculation never reads is never an error", () => {
    expect(ev("LET(a, 1 / 0, 5)")).toBe(5);
  });

  it("a LET out of form says what form it takes, and a constant can't be a name", () => {
    for (const bad of ["LET(a, 2)", "LET(1, 2, 3)", "LET(a, 2, b, 3)"]) {
      const r = ev(bad);
      expect(isSolError(r) && r.code, bad).toBe("#SYNTAX!");
      expect(isSolError(r) && r.message).toMatch(/LET takes a name and its value/);
    }
    const c = ev("LET(e, 2, e * 2)");
    expect(isSolError(c) && c.code).toBe("#NAME?");
  });

  it("is typeset as the LET it was typed as", () => {
    expect(formulaToLatex("LET(a, 2, b, a + 1, a * b)")).toBe("\\operatorname{LET}\\!\\left(a,\\, 2,\\, b,\\, a + 1,\\, a \\cdot b\\right)");
  });
});
