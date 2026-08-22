import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";

// ─── matricesInFormulas: the broadcast-rules table, transcribed ──────────────────────────────
// v2.0/17-matrix-formulas.md Part 2, row by row. The table IS this test (oneMetricImpl):
// a change to either without the other fails here. PAD follows the standing
// rulings — element-wise ragged operands pad `null` (P3), never `#N/A`; shape
// CONSTRUCTION functions own their #N/A padding inside their registered impls
// (appendLadder) and never route through the broadcaster.
//
// Rank grammar (post-tagSpecialScalars): no scalar is an array, so Array.isArray at two
// depths is the complete test — a matrix is an array of ROW arrays.

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const M22 = [[1, 2], [3, 4]];

describe("the eleven rows", () => {
  it("B1 — s ∘ s → s", () => {
    expect(ev("x + y", { x: 2, y: 3 })).toBe(5);
  });

  it("B2 — s ∘ L(n) → L(n)", () => {
    expect(ev("x + y", { x: 10, y: [1, 2, 3] })).toEqual([11, 12, 13]);
  });

  it("B3 — L(n) ∘ L(n) → L(n), element-wise", () => {
    expect(ev("x * y", { x: [1, 2, 3], y: [4, 5, 6] })).toEqual([4, 10, 18]);
  });

  it("B4 — ragged lists pad with null (P3), never truncate or error", () => {
    expect(ev("x + y", { x: [1, 2, 3], y: [10, 20] })).toEqual([11, 22, null]);
  });

  it("B5 — s ∘ M → M, every cell", () => {
    expect(ev("x + 1", { x: M22 })).toEqual([[2, 3], [4, 5]]);
    expect(ev("SQRT(x)", { x: [[4, 9], [16, 25]] })).toEqual([[2, 3], [4, 5]]);
  });

  it("B6 — L(k) ∘ M(m×k): the row broadcasts down the rows", () => {
    expect(ev("x + y", { x: M22, y: [10, 20] })).toEqual([[11, 22], [13, 24]]);
  });

  it("B7 — width mismatch pads per row with null", () => {
    expect(ev("x + y", { x: M22, y: [10, 20, 30] })).toEqual([[11, 22, null], [13, 24, null]]);
  });

  it("B8 — M ∘ M same shape, cell by cell", () => {
    expect(ev("x * y", { x: M22, y: M22 })).toEqual([[1, 4], [9, 16]]);
  });

  it("B9 — singleton axes broadcast, then mismatches pad", () => {
    // A column (m×1) broadcasts across the columns.
    expect(ev("x + y", { x: M22, y: [[100], [200]] })).toEqual([[101, 102], [203, 204]]);
    // A single row (1×k) broadcasts down the rows.
    expect(ev("x + y", { x: [[1, 2], [3, 4], [5, 6]], y: [[1, 2]] })).toEqual([[2, 4], [4, 6], [6, 8]]);
    // A genuine row-count mismatch (neither is 1) pads the missing rows.
    expect(ev("x + y", { x: [[1, 2], [3, 4], [5, 6]], y: [[10, 10], [20, 20]] }))
      .toEqual([[11, 12], [23, 24], [null, null]]);
  });

  it("B10 — a 1×1 matrix is its scalar", () => {
    expect(ev("x + y", { x: [[7]], y: M22 })).toEqual([[8, 9], [10, 11]]);
    expect(ev("x + 1", { x: [[41]] })).toBe(42);
  });

  it("B11 — a 1-element list broadcasts as its scalar (the unbuilt half of P3)", () => {
    // The zip used to pad this to [6, null, null]; P3's ruling ("length-1 still
    // broadcasts") says the singleton is the scalar it holds.
    expect(ev("x + y", { x: [5], y: [1, 2, 3] })).toEqual([6, 7, 8]);
    expect(ev("x * y", { x: [2], y: M22 })).toEqual([[2, 4], [6, 8]]);
  });
});

describe("the per-cell value model rides through rank 2 unchanged", () => {
  it("a cell error propagates in place (errorBeatsMissing)", () => {
    const err = { __solError: true, code: "#DIV/0!", message: "x" };
    const out = ev("x + 1", { x: [[1, err], [3, 4]] }) as unknown[][];
    expect(out[0][0]).toBe(2);
    expect((out[0][1] as { code: string }).code).toBe("#DIV/0!");
    expect(out[1]).toEqual([4, 5]);
  });

  it("a cell null propagates as null, not 0 (nullSkippedNotZero)", () => {
    expect(ev("x + 1", { x: [[1, null], [3, 4]] })).toEqual([[2, null], [4, 5]]);
  });

  it("unary and percent map over a matrix like any element-wise op", () => {
    expect(ev("-x", { x: M22 })).toEqual([[-1, -2], [-3, -4]]);
    expect(ev("x%", { x: [[50, 100]] })).toEqual([[0.5, 1]]);
  });
});

describe("aggregates flatten row-major; their 1-D prep applies unchanged", () => {
  it("SUM / MAX over a matrix", () => {
    expect(ev("SUM(x)", { x: M22 })).toBe(10);
    expect(ev("MAX(x)", { x: M22 })).toBe(4);
  });

  it("the null-skip policy carries over (AVERAGE ignores a missing cell)", () => {
    expect(ev("AVERAGE(x)", { x: [[1, 2], [3, null]] })).toBe(2);
  });

  it("an in-matrix error still poisons the aggregate (aggregator policy)", () => {
    const err = { __solError: true, code: "#DIV/0!", message: "x" };
    const r = ev("SUM(x)", { x: [[1, err]] });
    expect((r as { code: string }).code).toBe("#DIV/0!");
  });
});

describe("the matricesInFormulas containment rule", () => {
  it("a 1-D whole-list native refuses a matrix honestly (#SHAPE!)", () => {
    const r = ev("REVERSE(x)", { x: M22 });
    expect((r as { code: string }).code).toBe("#SHAPE!");
  });

  it("a positional lookup refuses a matrix until its 2-D form is registered", () => {
    const r = ev("XMATCH(2, x)", { x: M22 });
    expect((r as { code: string }).code).toBe("#SHAPE!");
  });

  it("anything deeper than a matrix is #SHAPE!", () => {
    const r = ev("x + 1", { x: [[[1]]] });
    expect((r as { code: string }).code).toBe("#SHAPE!");
  });
});
