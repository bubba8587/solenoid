import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";
import { isLambdaValue } from "./lambdaValue";
import { MapTableNode, ByAxisNode, ReduceLambdaNode, ScanLambdaNode, MakeArrayNode } from "./nodes/tableLambda";
import { GroupByNode, RunningNode } from "./nodes/list";
import { isSolError, type SolError } from "./errorValue";

// ─── matricesInFormulas lambda tranche: the language feature, node-equals-formula ────────────
// LAMBDA is the evaluator's one SPECIAL FORM; the hosts are registrations that
// receive the SAME tagged LambdaValue the LAMBDA node emits. The parity target:
// a host NODE with an inline formula and the formula host with an inline
// LAMBDA(...) run the identical evaluation core, so identical inputs must give
// identical outputs — the shareImpl discipline, closing gap A to ZERO.

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const M = [[1, 2], [3, 4]];
const code = (v: unknown) => (isSolError(v) ? (v as SolError).code : v);

describe("LAMBDA — the special form", () => {
  it("evaluates to the LAMBDA node's own tagged currency, unevaluated until applied", () => {
    // Reaching inside via a host proves construction; the raw special form is
    // checked through MAP rather than the top level (which refuses, below).
    const out = ev("MAP(x, LAMBDA(v, v * 2))", { x: [1, 2, 3] });
    expect(out).toEqual([2, 4, 6]);
  });

  it("an UNAPPLIED lambda at the top level is a typed #VALUE!, not a leaked object", () => {
    const r = ev("LAMBDA(v, v * 2)");
    expect(code(r)).toBe("#VALUE!");
    expect(isLambdaValue(r)).toBe(false);
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

describe("each host computes what its node computes (shareImpl)", () => {
  it("MAP — per cell, with the node's (value, value2, value3, row, col) binding", () => {
    const node = new MapTableNode({ expr: "value * 2" });
    expect(ev("MAP(m, LAMBDA(value, value * 2))", { m: M }))
      .toEqual(node.data({ table: [M] }).result);
    // Two arrays zip cell-wise, like the node's table2.
    const node2 = new MapTableNode({ expr: "value * value2" });
    expect(ev("MAP(a, b, LAMBDA(v, w, v * w))", { a: M, b: M }))
      .toEqual(node2.data({ table: [M], table2: [M] }).result);
    // A LIST maps to a list (rank preserved), matching the row convention.
    expect(ev("MAP(x, LAMBDA(v, v + 1))", { x: [1, 2, 3] })).toEqual([2, 3, 4]);
  });

  it("BYROW / BYCOL — the whole row/column reaches the lambda as a LIST", () => {
    const rowNode = new ByAxisNode({ axis: "row", expr: "SUM(values)" });
    expect(ev("BYROW(m, LAMBDA(values, SUM(values)))", { m: M }))
      .toEqual(rowNode.data({ table: [M] }).result);
    const colNode = new ByAxisNode({ axis: "col", expr: "MAX(values)" });
    expect(ev("BYCOL(m, LAMBDA(values, MAX(values)))", { m: M }))
      .toEqual(colNode.data({ table: [M] }).result);
  });

  it("REDUCE / SCAN — the fold pair, (acc, value, step), row-major", () => {
    const reduceNode = new ReduceLambdaNode({ expr: "acc + value", literals: { initial: 0 } });
    expect(ev("REDUCE(0, m, LAMBDA(acc, value, acc + value))", { m: M }))
      .toEqual(reduceNode.data({ table: [M] }).result);
    const scanNode = new ScanLambdaNode({ expr: "acc + value", literals: { initial: 0 } });
    expect(ev("SCAN(0, m, LAMBDA(acc, value, acc + value))", { m: M }))
      .toEqual(scanNode.data({ table: [M] }).result);
    // SCAN over a list ≡ the Running card's cumulative SUM — the general fold agreeing
    // with the task-shaped RUNNING("sum", x). Asserted against the NODE so this pins
    // the lambda machinery, not the RUNNING wrapper (formulaTier3 covers that).
    expect(ev("SCAN(0, x, LAMBDA(a, v, a + v))", { x: [1, 2, 3, 4] }))
      .toEqual(new RunningNode({ op: "sum" }).data({ list: [[1, 2, 3, 4]] }).result);
  });

  it("MAKEARRAY — (row, col) 1-based; an n×1 result reads as a LIST", () => {
    const node = new MakeArrayNode({ expr: "row * 10 + col", literals: { rows: 2, cols: 3 } });
    expect(ev("MAKEARRAY(2, 3, LAMBDA(row, col, row * 10 + col))"))
      .toEqual(node.data({}).result);
    expect(ev("MAKEARRAY(3, 1, LAMBDA(r, c, r))")).toEqual([1, 2, 3]);
    expect(code(ev("MAKEARRAY(2000, 2000, LAMBDA(r, c, r))"))).toBe("#OVERFLOW!");
  });

  it("GROUPBY — first-seen groups, VALUE-keyed, lambda per group's value list", () => {
    const k = ["a", "b", "a", "b"], v = [1, 2, 3, 4];
    const node = new GroupByNode({ op: "sum" });
    const nodeOut = node.data({ keys: [k], values: [v] });
    const fx = ev("GROUPBY(k, v, LAMBDA(g, SUM(g)))", { k, v }) as unknown[][];
    expect(fx.map((r) => r[0])).toEqual(nodeOut.keys);
    expect(fx.map((r) => r[1])).toEqual(nodeOut.values);
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
    expect(ev("BYROW(m, SUM)", { m: M })).toEqual([3, 7]);
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
