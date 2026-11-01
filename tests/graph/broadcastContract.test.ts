// [[D86]], [[C24]] arraySemantics
import { describe, it, expect } from "vitest";
import { readInput } from "../../src/graph/nodes/shared";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { guardFinite } from "../../src/graph/valueKinds";
import { solError, isSolError } from "../../src/graph/errorValue";

// The per-cell error/null contract, factored into every element-wise broadcaster
// (docs/backlog.md 1.0-tail item 1). ONE rule, per output cell, BEFORE the op:
// a SolError operand propagates unmorphed (first in arg order); else a missing
// (null) operand propagates as null; else compute. So an in-range list cell
// behaves identically to a scalar and to a ragged-padded position.
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

describe("guardFinite — a computation never yields a bare NaN/Infinity", () => {
  it("NaN → #DOMAIN!", () => {
    const r = guardFinite(NaN, [0, Infinity]);
    expect(isSolError(r) && (r as { code: string }).code).toBe("#DOMAIN!");
  });
  it("±Inf from all-finite inputs → #OVERFLOW!", () => {
    const r = guardFinite(Infinity, [1e308, 10]);
    expect(isSolError(r) && (r as { code: string }).code).toBe("#OVERFLOW!");
    const r2 = guardFinite(-Infinity, [5, 3]);
    expect(isSolError(r2) && (r2 as { code: string }).code).toBe("#OVERFLOW!");
  });
  it("±Inf when an INPUT was already infinite → passes through", () => {
    expect(guardFinite(Infinity, [Infinity, 5])).toBe(Infinity);
    expect(guardFinite(-Infinity, [2, -Infinity])).toBe(-Infinity);
  });
  it("a finite result passes through unchanged", () => {
    expect(guardFinite(42, [6, 7])).toBe(42);
    expect(guardFinite(0, [0, 0])).toBe(0);
  });


  it("formula: 2^5000 → #OVERFLOW!, EXP(1000) → #OVERFLOW!, 0^0 → 1", () => {
    const ev = (expr: string) => compileEvaluator(expr)!({});
    expect(isSolError(ev("2 ^ 5000")) && (ev("2 ^ 5000") as { code: string }).code).toBe("#OVERFLOW!");
    expect(isSolError(ev("EXP(1000)"))).toBe(true);
    expect(ev("0 ^ 0")).toBe(1);
  });
});

