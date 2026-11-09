// [[D86]], [[C24]] arraySemantics, [[error-values#The per-cell contract and the non-finite guard]], [[D86]] blankRoles, [[formula-language#Broadcast]], [[formula-language#Numeric and vendor boundaries]]
import { describe, it, expect } from "vitest";
import { readInput } from "../../src/graph/nodes/shared";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { solError } from "../../src/graph/errorValue";

const e = solError("#DIV/0!", "boom");

describe("readInput — unwired (undefined) vs wired-missing (null)", () => {
  it("unwired slot falls back to the literal", () => {
    expect(readInput(undefined, 7)).toBe(7);
    expect(readInput([], 7)).toBe(7);
  });
  it("a wired value wins, even 0", () => {
    expect(readInput([3], 7)).toBe(3);
    expect(readInput([0], 7)).toBe(0);
  });
  it("a WIRED null propagates — NOT swallowed into the literal", () => {
    expect(readInput([null], 7)).toBe(null);
  });

});

describe("broadcastCall / unary / percent — formula-layer broadcasters", () => {
  const ev = (expr: string, env: Record<string, unknown> = {}) => {
    const fn = compileEvaluator(expr);
    if (!fn) throw new Error(`failed to compile: ${expr}`);
    return fn(env);
  };

  it("a per-cell error propagates through a function call, unmorphed", () => {
    const r = ev("ABS(a)", { a: [-1, e, -3] }) as unknown[];
    expect(r[0]).toBe(1);
    expect(r[1]).toBe(e);
    expect(r[2]).toBe(3);
  });

  it("a per-cell missing propagates as null through a function call", () => {
    const r = ev("ROUND(a, 0)", { a: [1.4, null, 3.6] }) as unknown[];
    expect(r).toEqual([1, null, 4]);
  });

  it("a null-inspecting predicate still SEES the blank (ISBLANK)", () => {
    const r = ev("ISBLANK(a)", { a: [1, null, 3] }) as unknown[];
    expect(r).toEqual([false, true, false]);
  });

  it("unary minus propagates error/missing per cell (not -0 for null)", () => {
    const r = ev("-a", { a: [1, null, e] }) as unknown[];
    expect(r[0]).toBe(-1);
    expect(r[1]).toBe(null);
    expect(r[2]).toBe(e);
  });

  it("percent propagates error/missing per cell", () => {
    const r = ev("a%", { a: [50, null, e] }) as unknown[];
    expect(r[0]).toBe(0.5);
    expect(r[1]).toBe(null);
    expect(r[2]).toBe(e);
  });
});

