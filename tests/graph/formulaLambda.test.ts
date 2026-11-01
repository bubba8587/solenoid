import { describe, it, expect } from "vitest";
import { compileEvaluator, compilePositional, extractVariables } from "../../src/graph/excelFormula";

import { isSolError, type SolError } from "../../src/graph/errorValue";

// ─── [[C15]] matricesInFormulas lambda tranche: the language feature, node-equals-formula ────────────
// LAMBDA is the evaluator's one SPECIAL FORM; the hosts are registrations that
// receive the SAME tagged LambdaValue the LAMBDA node emits. The parity target:
// a host NODE with an inline formula and the formula host with an inline
// LAMBDA(...) run the identical evaluation core, so identical inputs must give
// identical outputs — the [[C17]] shareImpl discipline, closing gap A to ZERO.

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const M = [[1, 2], [3, 4]];
const code = (v: unknown) => (isSolError(v) ? (v as SolError).code : v);

describe("LAMBDA parameters and eta names are not the host's variables", () => {
  it("a LAMBDA's parameters grow no socket", () => {
    expect(extractVariables("MAP(x, LAMBDA(v, v * 2))")).toEqual(["x"]);
    expect(extractVariables("REDUCE(0, xs, LAMBDA(acc, v, acc + v * k))")).toEqual(["xs", "k"]);
  });

  it("a bare function name in a lambda slot is eta, not a variable", () => {
    expect(extractVariables("MAP(x, SQRT)")).toEqual(["x"]);
  });

  it("a constant keeps its meaning inside a LAMBDA body ([[C50]] lambdaBindsByName)", () => {
    expect(ev("LAMBDA(x, x + e)(1)")).toBeCloseTo(1 + Math.E);
    expect(ev("MAP(xs, LAMBDA(v, v * PI))", { xs: [1, 2] })).toEqual([Math.PI, 2 * Math.PI]);
  });



  it("a positional binding never shadows a constant ([[C50]] lambdaBindsByName)", () => {
    expect(compilePositional("e + 1", ["e"])!(5)).toBeCloseTo(Math.E + 1);
    expect(compilePositional("pi * r", ["r"])!(1)).toBeCloseTo(Math.PI);
  });
});

describe("LAMBDA — the special form", () => {
  it("an UNAPPLIED lambda at the top level is a typed #VALUE!, not a leaked object", () => {
    const r = ev("LAMBDA(v, v * 2)");
    expect(code(r)).toBe("#VALUE!");
  });

  it("parameters must be plain names; a closure captures the outer env", () => {
    expect(code(ev("MAP(x, LAMBDA(1, v))", { x: [1] }))).toBe("#VALUE!");
    // `k` is free in the lambda body — captured from the formula's variables.
    expect(ev("MAP(x, LAMBDA(v, v + k))", { x: [1, 2], k: 100 })).toEqual([101, 102]);
  });

  it("a non-lambda where a lambda belongs is a typed #VALUE! naming the host", () => {
    const r = ev("MAP(x, 5)", { x: [1, 2] });
    expect(code(r)).toBe("#VALUE!");
    expect((r as SolError).message).toContain("MAP");
  });
});


describe("the value model rides through lambdas", () => {
  it("a cell error stops REDUCE and propagates (aggregator policy)", () => {
    const err = { __solError: true, code: "#DIV/0!", message: "x" };
    expect(code(ev("REDUCE(0, x, LAMBDA(a, v, a + v))", { x: [1, err, 3] }))).toBe("#DIV/0!");
  });

  it("a null cell reaches the lambda; its body's operators carry the P6 contract", () => {
    expect(ev("MAP(x, LAMBDA(v, v + 1))", { x: [1, null, 3] })).toEqual([2, null, 4]);
  });

  it("results compose with the rest of the language", () => {
    expect(ev("SUM(MAP(x, LAMBDA(v, v * v)))", { x: [1, 2, 3] })).toBe(14);
    expect(ev("MDETERM(MAKEARRAY(2, 2, LAMBDA(r, c, IF(r = c, 1, 0))))")).toBe(1);
  });
});

describe("eta-lambdas and application — the recorded deviations, closed", () => {
  // Excel parity: a BARE dispatchable name works where a lambda belongs
  // (`MAP(x, SQRT)` — eta), and a lambda value applies with `(…)` — inline
  // (IIFE), curried, or through a parameter (higher-order). The eta wrapper
  // declares no params and is marked `eta`, so hosts call it with their
  // MEANINGFUL arity only (etaFn): a raw SQRT never sees MAP's row/col tuple.
  it("eta: a bare function name in a host's fn slot", () => {
    expect(ev("MAP(x, SQRT)", { x: [1, 4, 9] })).toEqual([1, 2, 3]);
    expect(ev("BYROW(m, SUM)", { m: M })).toEqual([[3], [7]]);
    expect(ev("BYCOL(m, MAX)", { m: M })).toEqual([3, 4]);
    expect(ev("REDUCE(0, x, SUM)", { x: [1, 2, 3, 4] })).toBe(10);
    expect(ev("SCAN(0, x, SUM)", { x: [1, 2, 3] })).toEqual([1, 3, 6]);
    // Two arrays: the eta wrapper receives exactly the wired arrays' cells.
    expect(ev("MAP(a, b, SUM)", { a: [1, 2], b: [10, 20] })).toEqual([11, 22]);
    // A dispatch failure classifies per cell like any other computed error.
    expect(code((ev("MAP(x, SQRT)", { x: [4, -1] }) as unknown[])[1])).toBe("#DOMAIN!");
  });

  it("eta never shadows: a variable or param named like a function wins", () => {
    expect(ev("MAP(x, LAMBDA(SUM, SUM * 2))", { x: [5] })).toEqual([10]);
    expect(code(ev("MAP(x, NOTAFUNCTION)", { x: [1] }))).toBe("#VALUE!");
  });

  it("application: IIFE, curried, higher-order, and the honest refusals", () => {
    expect(ev("LAMBDA(x, x + 1)(5)")).toBe(6);
    expect(ev("LAMBDA(x, LAMBDA(y, x + y))(2)(3)")).toBe(5);
    expect(ev("LAMBDA(f, f(9))(SQRT)")).toBe(3); // eta rides an APPLY's args too
    expect(code(ev("LAMBDA(x, x)(1, 2)"))).toBe("#VALUE!"); // declared arity is checked
    expect(code(ev("(1 + 2)(3)"))).toBe("#VALUE!"); // only a lambda applies
  });

  it("a lambda leaking into an operator refuses (the [object Object] class)", () => {
    expect(code(ev("LAMBDA(f, f + 1)(SQRT)"))).toBe("#TYPE!");
  });
});

describe("a helper's LAMBDA answers one value each time, as Excel's do", () => {
  it("a list answer is #SHAPE!, not a value nested past a table", () => {
    const env = { ys: [3, 1, 2], m: [[1, 2], [3, 4]] };
    expect(code((ev("BYROW(ys, LAMBDA(r, r * 2))", env) as unknown[][])[0][0])).toBe("#SHAPE!");
    expect(code((ev("BYCOL(m, LAMBDA(c, c * 2))", env) as unknown[])[0])).toBe("#SHAPE!");
    expect(code((ev("MAP(m, LAMBDA(v, SEQUENCE(2)))", env) as unknown[][])[0][0])).toBe("#SHAPE!");
    expect(code((ev("MAKEARRAY(1, 1, LAMBDA(i, j, SEQUENCE(2)))", env) as unknown[][])[0][0])).toBe("#SHAPE!");
    expect(code((ev("SCAN(0, ys, LAMBDA(a, v, SEQUENCE(v)))", env) as unknown[])[0])).toBe("#SHAPE!");
    // One value per row still reads as before, and REDUCE may build a list.
    expect(ev("BYROW(m, LAMBDA(r, SUM(r)))", env)).toEqual([[3], [7]]);
    expect(ev("REDUCE(0, ys, LAMBDA(a, v, a + v))", env)).toBe(6);
  });
  it("a list or table of one cell is that cell", () => {
    const env = { ys: [3, 1, 2], keys: ["a", "b", "c"], vals: [10, 20, 30], col: [[1], [2], [3]] };
    expect(ev("MAP(ys, LAMBDA(x, FILTER(vals, keys = \"b\")))", env)).toEqual([20, 20, 20]);
    expect(ev("BYROW(col, LAMBDA(r, r))", env)).toEqual([[1], [2], [3]]);
    expect(code((ev("MAP(ys, LAMBDA(x, FILTER(vals, keys <> \"b\")))", env) as unknown[])[0])).toBe("#SHAPE!");
  });
  it("MAKEARRAY caps rows and columns each, so no columns can't hide a billion rows", () => {
    for (const s of ["MAKEARRAY(1e9, 0, LAMBDA(i, j, 1))", "MAKEARRAY(0, 1e9, LAMBDA(i, j, 1))"]) expect(code(ev(s) as SolError)).toBe("#OVERFLOW!");
    expect(ev("MAKEARRAY(2, 0, LAMBDA(i, j, 1))")).toEqual([[], []]);
  });
});
