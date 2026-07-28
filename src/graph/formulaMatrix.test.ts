import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";
import { EXCEL_IMPL_META } from "./excelFunctions";
import {
  MatDetNode, TableMultNode, TableTransposeNode, TableUnitNode, TableReshapeNode,
} from "./nodes/matrix";
import { SequenceNode } from "./nodes/list";
import { isSolError, type SolError } from "./errorValue";

// ─── D23 tranche 1: the matrix core, node-equals-formula (FX-1) ───────────────
// Every matrix registration delegates to the same kernels the nodes run, so the
// test that matters is equality against the NODE, not correctness in isolation —
// the Tier 1/Tier 3 discipline at rank 2. Error CODES are part of the contract
// (the node family's #TYPE!/#VALUE!/#SHAPE!/#DIV/0! taxonomy).

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const M = [[1, 2], [3, 4]];
const code = (v: unknown) => (isSolError(v) ? (v as SolError).code : v);

describe("each matrix name computes what its node computes", () => {
  it("MMULT — including the mismatch #SHAPE! and the non-numeric #TYPE!", () => {
    const I = [[1, 0], [0, 1]];
    expect(ev("MMULT(a, b)", { a: M, b: I })).toEqual(new TableMultNode().data({ a: [M], b: [I] }).result);
    expect(ev("MMULT(a, b)", { a: M, b: M })).toEqual(new TableMultNode().data({ a: [M], b: [M] }).result);
    const mismatch = { a: [[1, 2]], b: [[1, 2]] };
    expect(code(ev("MMULT(a, b)", mismatch))).toBe("#SHAPE!");
    expect(code(new TableMultNode().data({ a: [mismatch.a], b: [mismatch.b] }).result)).toBe("#SHAPE!");
    const texty = [["a", "b"], ["c", "d"]];
    expect(code(ev("MMULT(a, b)", { a: texty, b: M }))).toBe("#TYPE!");
    expect(code(new TableMultNode().data({ a: [texty], b: [M] }).result)).toBe("#TYPE!");
  });

  it("MDETERM / MINVERSE — value, #SHAPE! non-square, #DIV/0! singular", () => {
    expect(ev("MDETERM(m)", { m: M })).toBe(new MatDetNode({ op: "mdeterm" }).data({ matrix: [M] }).result);
    expect(ev("MINVERSE(m)", { m: M })).toEqual(new MatDetNode({ op: "minverse" }).data({ matrix: [M] }).result);
    const rect = [[1, 2, 3], [4, 5, 6]];
    expect(code(ev("MDETERM(m)", { m: rect }))).toBe("#SHAPE!");
    expect(code(new MatDetNode({ op: "mdeterm" }).data({ matrix: [rect] }).result)).toBe("#SHAPE!");
    const singular = [[1, 2], [2, 4]];
    expect(code(ev("MDETERM(m)", { m: singular }))).toBe("#DIV/0!");
    expect(code(new MatDetNode({ op: "mdeterm" }).data({ matrix: [singular] }).result)).toBe("#DIV/0!");
  });

  it("TRANSPOSE — and a LIST transposes to a COLUMN, not an element-wise map", () => {
    expect(ev("TRANSPOSE(m)", { m: M })).toEqual(new TableTransposeNode().data({ matrix: [M] }).result);
    expect(ev("TRANSPOSE(x)", { x: [1, 2, 3] })).toEqual([[1], [2], [3]]);
  });

  it("MUNIT", () => {
    expect(ev("MUNIT(3)")).toEqual(new TableUnitNode().data({ n: [3] }).result);
  });

  it("WRAPROWS / WRAPCOLS — #N/A pads (D15), pad_with overrides", () => {
    const x = [1, 2, 3, 4, 5];
    const nodeRows = new TableReshapeNode({ op: "wraprows" }).data({ list: [x], wrapCount: [3] }).result as unknown[][];
    const fxRows = ev("WRAPROWS(x, 3)", { x }) as unknown[][];
    expect(fxRows[0]).toEqual(nodeRows[0]);
    expect(fxRows[1].slice(0, 2)).toEqual(nodeRows[1].slice(0, 2));
    expect(code(fxRows[1][2])).toBe("#N/A");
    expect(code(nodeRows[1][2])).toBe("#N/A");
    expect(ev("WRAPROWS(x, 3, 0)", { x })).toEqual([[1, 2, 3], [4, 5, 0]]);
    const nodeCols = new TableReshapeNode({ op: "wrapcols" }).data({ list: [x], wrapCount: [3] }).result as unknown[][];
    const fxCols = ev("WRAPCOLS(x, 3, 0)", { x }) as unknown[][];
    expect(fxCols[0][0]).toBe(nodeCols[0][0]);
    expect(fxCols.length).toBe(nodeCols.length);
  });

  it("TOCOL / TOROW — the node's exact scan orders", () => {
    expect(ev("TOCOL(m)", { m: M })).toEqual(new TableReshapeNode({ op: "tocol" }).data({ matrix: [M] }).result);
    expect(ev("TOROW(m)", { m: M })).toEqual(new TableReshapeNode({ op: "torow" }).data({ matrix: [M] }).result);
  });

  it("SEQUENCE — the 1-D form IS the Sequence node; cols wraps the same arithmetic", () => {
    expect(ev("SEQUENCE(4)")).toEqual(new SequenceNode().data({ count: [4], start: [1], step: [1] }).list);
    expect(ev("SEQUENCE(4,, 10, 5)")).toEqual(new SequenceNode().data({ count: [4], start: [10], step: [5] }).list);
    expect(ev("SEQUENCE(2, 3)")).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(code(ev("SEQUENCE(2000000)"))).toBe("#OVERFLOW!");
  });
});

describe("ownership displaced the broadcast garbage (FX-9's point)", () => {
  it("MMULT is a matrix product, not the element-wise Hadamard the fallthrough gave", () => {
    // Pre-tranche this answered [[{},{}],[{},{}]] — Formula.js MMULT mapped
    // cell-wise. If this test ever sees a 2×2 of objects again, the meta lost
    // its matrixArgs and the containment guard stopped routing.
    const r = ev("MMULT(a, b)", { a: M, b: M }) as number[][];
    expect(r).toEqual([[7, 10], [15, 22]]);
    expect(typeof r[0][0]).toBe("number");
  });

  it("results COMPOSE through the rank-2 engine", () => {
    expect(ev("SUM(MMULT(a, b))", { a: M, b: M })).toBe(54);
    expect(ev("MDETERM(MINVERSE(m)) * MDETERM(m)", { m: M })).toBeCloseTo(1, 10);
    expect(ev("TRANSPOSE(TRANSPOSE(m))", { m: M })).toEqual(M);
  });

  it("every tranche registration declares the FX-9 gate", () => {
    for (const name of ["TRANSPOSE", "MMULT", "MUNIT", "MDETERM", "MINVERSE", "WRAPROWS", "WRAPCOLS", "TOCOL", "TOROW", "SEQUENCE"]) {
      expect(EXCEL_IMPL_META[name]?.matrixArgs, `${name} lost matrixArgs`).toBe(true);
      expect(EXCEL_IMPL_META[name]?.listArgs, `${name} lost listArgs (rank-1 args must arrive whole too)`).toBe(true);
    }
  });
});

describe("D23 tranche 2 — the array-returning core, node-equals-formula", () => {
  it("UNIQUE / SORT / SORTBY match their nodes (incl. blanks-last)", async () => {
    const { UniqueNode, SortNode, SortByNode } = await import("./nodes/list");
    const x = [3, 1, 3, null, 2];
    expect(ev("UNIQUE(x)", { x: [3, 1, 3, 2] })).toEqual(new UniqueNode().data({ list: [[3, 1, 3, 2]] }).result);
    expect(ev("SORT(x)", { x })).toEqual(new SortNode({ op: "asc" }).data({ list: [x] }).result);
    expect(ev("SORT(x,,-1)", { x })).toEqual(new SortNode({ op: "desc" }).data({ list: [x] }).result);
    const a = ["x", "y", "z"], by = [3, 1, 2];
    expect(ev("SORTBY(a, b)", { a, b: by })).toEqual(new SortByNode().data({ array: [a], by_array: [by] }).list);
  });

  it("TAKE / DROP share the signed kernel with all three nodes", async () => {
    const { TakeNode, DropNode } = await import("./nodes/list");
    const { TableTakeDropNode } = await import("./nodes/matrix");
    const x = [1, 2, 3, 4];
    expect(ev("TAKE(x, 2)", { x })).toEqual(new TakeNode({ op: "first" }).data({ list: [x], count: [2] }).result);
    expect(ev("TAKE(x, -2)", { x })).toEqual(new TakeNode({ op: "last" }).data({ list: [x], count: [2] }).result);
    expect(ev("DROP(x, 1)", { x })).toEqual(new DropNode({ op: "first" }).data({ list: [x], count: [1] }).result);
    const m = [[1, 2, 3], [4, 5, 6]];
    expect(ev("TAKE(m, 1, 2)", { m }))
      .toEqual(new TableTakeDropNode({ op: "take" }).data({ matrix: [m], rows: [1], cols: [2] }).result);
    expect(ev("DROP(m, 1, -1)", { m }))
      .toEqual(new TableTakeDropNode({ op: "drop" }).data({ matrix: [m], rows: [1], cols: [-1] }).result);
  });

  it("FILTER by mask — Excel's include-array form", () => {
    // The List Filter NODE is condition-ROW configured (per-row {op, matchCase}
    // with wired comparison values) — a different mechanism from Excel's computed
    // boolean mask, so FX-1's node-equality doesn't apply term-for-term here; the
    // shared ground is filterByMask (listOps), which this pins directly.
    const x = [1, 5, 2, 9];
    expect(ev("FILTER(x, x > 2)", { x })).toEqual([5, 9]);
    expect(ev("FILTER(x, m)", { x, m: [true, false, true, false] })).toEqual([1, 2]);
    expect(ev("FILTER(x, x > 99, 0)", { x })).toBe(0);      // if_empty
    expect(ev("FILTER(x, x > 99)", { x })).toEqual([]);      // no if_empty → empty list
    const r = ev("FILTER(x, y)", { x, y: [1, 0] });          // size mismatch
    expect((r as { code?: string }).code).toBe("#SHAPE!");
  });

  it("MODE.MULT and FREQUENCY are owned — no more element-wise garbage", () => {
    expect(ev("MODE.MULT(x)", { x: [1, 1, 2, 2, 3] })).toEqual([1, 2]);
    expect(ev("FREQUENCY(x, b)", { x: [1, 5, 9, 3], b: [4, 8] })).toEqual([2, 1, 1]);
    // Pre-tranche: UNIQUE([3,1,3,2]) broadcast to [[3],[1],[3],[2]].
    expect(ev("UNIQUE(x)", { x: [3, 1, 3, 2] })).toEqual([3, 1, 2]);
  });

  it("RANDARRAY is volatile and shape-correct (the SHUFFLE precedent)", () => {
    const r = ev("RANDARRAY(2, 3, 0, 10)") as number[][];
    expect(r.length).toBe(2);
    expect(r[0].length).toBe(3);
    expect(r.flat().every((v) => v >= 0 && v <= 10)).toBe(true);
    expect((ev("RANDARRAY(5,, 1, 6, TRUE)") as number[]).every((v) => Number.isInteger(v))).toBe(true);
  });
});
