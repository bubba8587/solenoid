import { describe, it, expect } from "vitest";
import { broadcast, broadcastErr, readInput } from "./nodes/shared";
import { compileEvaluator } from "./excelFormula";
import { ComparisonNode, IfNode, BooleanOpNode } from "./nodes/logic";
import { ArithmeticNode } from "./nodes/scalar";
import { guardFinite } from "./valueKinds";
import { solError, isSolError } from "./errorValue";

// The per-cell error/null contract, factored into every element-wise broadcaster
// (docs/backlog.md 1.0-tail item 1). ONE rule, per output cell, BEFORE the op:
// a SolError operand propagates unmorphed (first in arg order); else a missing
// (null) operand propagates as null; else compute. So an in-range list cell
// behaves identically to a scalar and to a ragged-padded position.
const e = solError("#DIV/0!", "boom");

describe("broadcast / broadcastErr — numeric node broadcasters", () => {
  it("error cell propagates UNMORPHED, not NaN / [object Object]", () => {
    const r = broadcast((x, y) => x + y, [1, e as unknown as number, 3], 10) as unknown[];
    expect(r[0]).toBe(11);
    expect(r[1]).toBe(e); // the exact error object, not NaN
    expect(r[2]).toBe(13);
  });

  it("missing cell propagates as null (null + 10 → null)", () => {
    const r = broadcast((x, y) => x + y, [1, null as unknown as number, 3], 10) as unknown[];
    expect(r).toEqual([11, null, 13]);
  });

  it("error beats missing at the same cell (error checked first)", () => {
    const r = broadcast((x, y) => x + y, [e as unknown as number], [null as unknown as number]) as unknown[];
    expect(r[0]).toBe(e);
  });

  it("ragged pad still yields null, unchanged", () => {
    const r = broadcast((x, y) => x + y, [1, 2, 3], [10, 20]) as unknown[];
    expect(r).toEqual([11, 22, null]);
  });

  it("scalar operands honour the contract too", () => {
    expect(broadcast((x) => x * 2, e as unknown as number)).toBe(e);
    expect(broadcast((x) => x * 2, null as unknown as number)).toBe(null);
    expect(broadcast((x) => x * 2, 5)).toBe(10);
  });

  it("broadcastErr carries the same rule (and the fn may mint its own error)", () => {
    const r = broadcastErr((x, y) => (y === 0 ? solError("#DIV/0!", "div") : x / y), [10, 20, 30], [2, 0, e as unknown as number]) as unknown[];
    expect(r[0]).toBe(5);
    expect(isSolError(r[1])).toBe(true); // fn-minted #DIV/0!
    expect(r[2]).toBe(e);                // operand error propagates unmorphed
  });
});

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

  it("Arithmetic: a wired null propagates (null + 5 → null), not the literal", () => {
    // b unwired → literal 5; a wired to a missing null.
    const add = new ArithmeticNode({ op: "add" });
    add.literals.a = 99; // the box value that the OLD `??` idiom would have used
    expect(add.data({ a: [null as unknown as number], b: [5] }).result).toBe(null);
    // Sanity: an unwired a still uses its literal box.
    expect(new ArithmeticNode({ op: "add" }).data({ b: [5] }).result).toBe(5); // 0 (literal) + 5
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
    const r = guardFinite(NaN, 0, Infinity);
    expect(isSolError(r) && (r as { code: string }).code).toBe("#DOMAIN!");
  });
  it("±Inf from all-finite inputs → #OVERFLOW!", () => {
    const r = guardFinite(Infinity, 1e308, 10);
    expect(isSolError(r) && (r as { code: string }).code).toBe("#OVERFLOW!");
    const r2 = guardFinite(-Infinity, 5, 3);
    expect(isSolError(r2) && (r2 as { code: string }).code).toBe("#OVERFLOW!");
  });
  it("±Inf when an INPUT was already infinite → passes through", () => {
    expect(guardFinite(Infinity, Infinity, 5)).toBe(Infinity);
    expect(guardFinite(-Infinity, 2, -Infinity)).toBe(-Infinity);
  });
  it("a finite result passes through unchanged", () => {
    expect(guardFinite(42, 6, 7)).toBe(42);
    expect(guardFinite(0, 0, 0)).toBe(0);
  });

  it("Arithmetic node: 10^400 overflows to #OVERFLOW!", () => {
    const r = new ArithmeticNode({ op: "pow" }).data({ a: [10], b: [400] }).result;
    expect(isSolError(r) && (r as { code: string }).code).toBe("#OVERFLOW!");
  });
  it("Arithmetic node: a wired ∞ input passes through (∞ + 5 = ∞)", () => {
    const r = new ArithmeticNode({ op: "add" }).data({ a: [Infinity], b: [5] }).result;
    expect(r).toBe(Infinity);
  });
  it("Arithmetic node: 0^0 stays 1 (JS/Python/Polars convention, parity:false)", () => {
    expect(new ArithmeticNode({ op: "pow" }).data({ a: [0], b: [0] }).result).toBe(1);
  });

  it("formula: 2^5000 → #OVERFLOW!, EXP(1000) → #OVERFLOW!, 0^0 → 1", () => {
    const ev = (expr: string) => compileEvaluator(expr)!({});
    expect(isSolError(ev("2 ^ 5000")) && (ev("2 ^ 5000") as { code: string }).code).toBe("#OVERFLOW!");
    expect(isSolError(ev("EXP(1000)"))).toBe(true);
    expect(ev("0 ^ 0")).toBe(1);
  });
});

describe("broadcastEl — the logic family gains the error guard, keeps Kleene null", () => {
  it("comparison over a list propagates an error cell unmorphed", () => {
    const r = new ComparisonNode({ op: "gt" }).data({ a: [[1, e, 3] as unknown as number[]], b: [2] }).result as unknown[];
    expect(r[0]).toBe(false);
    expect(r[1]).toBe(e);   // error, not a coerced comparison
    expect(r[2]).toBe(true);
  });

  it("comparison still feeds null to its own rule (null > 2 → null, not an error)", () => {
    const r = new ComparisonNode({ op: "gt" }).data({ a: [[1, null, 3]], b: [2] }).result as unknown[];
    expect(r).toEqual([false, null, true]);
  });

  it("BooleanOp propagates a per-cell error, Kleene-handles null", () => {
    // AND over element-wise operands: error cell → error; null follows Kleene.
    const r = new BooleanOpNode({ op: "and" }).data({ a0: [[1, 1, e] as unknown as number[]], a1: [[1, 0, 1]] }).result as unknown[];
    expect(r[0]).toBe(true);
    expect(r[1]).toBe(false); // Kleene: F wins
    expect(r[2]).toBe(e);
  });

  it("IF propagates an error in the CONDITION per cell", () => {
    const r = new IfNode().data({ cond: [[true, e, false]], then: [10], else: [20] }).result as unknown[];
    expect(r[0]).toBe(10);
    expect(r[1]).toBe(e);
    expect(r[2]).toBe(20);
  });
});
