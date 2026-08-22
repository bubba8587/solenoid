import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";
import { EXCEL_IMPL_META } from "./excelFunctions";
import {
  MatDetNode, TableMultNode, TableTransposeNode, TableUnitNode, TableReshapeNode, TableInfoNode,
  HStackTableNode, VStackNode, TableSelectNode, ExpandNode,
} from "./nodes/matrix";
import { SeriesNode } from "./nodes/list";
import { InterpolateNode } from "./nodes/stats";
import { isSolError, type SolError } from "./errorValue";

// ─── D23 tranche 1: the matrix core, node-equals-formula (shareImpl) ───────────────
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
    expect(ev("SEQUENCE(4)")).toEqual(new SeriesNode({ op: "sequence" }).data({ count: [4], start: [1], step: [1] }).list);
    expect(ev("SEQUENCE(4,, 10, 5)")).toEqual(new SeriesNode({ op: "sequence" }).data({ count: [4], start: [10], step: [5] }).list);
    expect(ev("SEQUENCE(2, 3)")).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(code(ev("SEQUENCE(2000000)"))).toBe("#OVERFLOW!");
  });
});

describe("ownership displaced the broadcast garbage (hideMatrixFromVendor's point)", () => {
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

  it("COLUMNS / ROWS count the shape, sharing the TableInfo node's math (shareImpl)", () => {
    // Pre-ownership these fell through to Formula.js element-wise, answering a
    // same-shape array of #VALUE! even on a 1-D list. Now both surfaces call
    // matrixShape: a list is a ROW here, so COLUMNS counts it and ROWS is 1; a
    // scalar is 1x1; a wired blank stays unknown. Assert equality against the node.
    const info = (v: unknown) => new TableInfoNode().data({ matrix: [v] });
    for (const v of [[[1, 2, 3], [4, 5, 6]], [1, 2, 3], 9, [], null] as unknown[]) {
      expect(ev("COLUMNS(v)", { v })).toBe(info(v).cols);
      expect(ev("ROWS(v)", { v })).toBe(info(v).rows);
    }
    // Composes: the count feeds ordinary math, no array leak.
    expect(ev("COLUMNS(m) * ROWS(m)", { m: [[1, 2, 3], [4, 5, 6]] })).toBe(6);
  });

  it("HSTACK / VSTACK / CHOOSECOLS / CHOOSEROWS / EXPAND compute what their nodes do (shareImpl)", () => {
    const a = [[1, 2], [3, 4]], b = [[5, 6], [7, 8]];
    expect(ev("HSTACK(a, b)", { a, b })).toEqual(new HStackTableNode().data({ t0: [a], t1: [b] }).result);
    expect(ev("VSTACK(a, b)", { a, b })).toEqual(new VStackNode().data({ t0: [a], t1: [b] }).result);
    // A bare list is one ROW on both surfaces.
    expect(ev("VSTACK(u, u)", { u: [1, 2, 3] })).toEqual(new VStackNode().data({ t0: [[1, 2, 3]], t1: [[1, 2, 3]] }).result);
    // Ragged inputs pad with #N/A (shape construction, D15) — identical to the node.
    expect(ev("HSTACK(a, w)", { a, w: [[9], [8], [7]] })).toEqual(new HStackTableNode().data({ t0: [a], t1: [[[9], [8], [7]]] }).result);

    expect(ev("CHOOSECOLS(a, 2)", { a })).toEqual(new TableSelectNode({ op: "choosecols" }).data({ matrix: [a], indices: [[2]] }).result);
    expect(ev("CHOOSEROWS(a, 1, 2)", { a })).toEqual(new TableSelectNode({ op: "chooserows" }).data({ matrix: [a], indices: [[1, 2]] }).result);
    expect(code(ev("CHOOSECOLS(a, 5)", { a }))).toBe("#VALUE!"); // out of range, both surfaces
    expect(code(new TableSelectNode({ op: "choosecols" }).data({ matrix: [a], indices: [[5]] }).result)).toBe("#VALUE!");

    // EXPAND pads with first-class null (the author override of Excel's #N/A), and the
    // node agrees because both call expandMat with the same omitted-Fill default.
    expect(ev("EXPAND(a, 3, 3)", { a })).toEqual(new ExpandNode().data({ matrix: [a], rows: [3], cols: [3] }).result);
    expect((ev("EXPAND(a, 3, 3)", { a }) as unknown[][])[2][2]).toBeNull();
    expect(code(ev("EXPAND(a, 1, 1)", { a }))).toBe("#VALUE!"); // shrink is refused, both surfaces
  });

  it("the D* database family is BLOCKED like VLOOKUP/MATCH (superseded by Frame Filter)", () => {
    for (const name of ["DSUM", "DAVERAGE", "DCOUNT", "DGET", "DMAX", "DMIN", "DPRODUCT", "DSTDEV", "DVAR"]) {
      expect(code(ev(`${name}(a, 1, a)`, { a: [[1, 2], [3, 4]] })), name).toBe("#NAME?");
    }
  });

  it("every tranche registration declares the hideMatrixFromVendor gate", () => {
    for (const name of ["TRANSPOSE", "MMULT", "MUNIT", "MDETERM", "MINVERSE", "WRAPROWS", "WRAPCOLS", "TOCOL", "TOROW", "SEQUENCE", "COLUMNS", "ROWS", "HSTACK", "VSTACK", "CHOOSECOLS", "CHOOSEROWS", "EXPAND"]) {
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

  it("INDEX is the node's accessor — whole-axis and rank 2, not a 1-D pick", async () => {
    const { ListIndexNode } = await import("./nodes/list");
    const node = (v: unknown, row?: number, col?: number) =>
      new ListIndexNode().data({ list: [v], index: row === undefined ? undefined : [row], column: col === undefined ? undefined : [col] }).result;
    const x = [10, 20, 30];
    expect(ev("INDEX(x, 2)", { x })).toEqual(node(x, 2));
    expect(ev("INDEX(x, 0)", { x })).toEqual(node(x));            // 0 = the whole axis
    expect(ev("INDEX(m, 2, 1)", { m: M })).toEqual(node(M, 2, 1)); // a cell out of rank 2
    expect(ev("INDEX(m, 0, 2)", { m: M })).toEqual(node(M, 0, 2)); // whole column → 1-D list
    expect(ev("INDEX(m, 1, 0)", { m: M })).toEqual(node(M, 1, 0)); // whole row → 1-D list
    expect(ev("INDEX(m, 0, 0)", { m: M })).toEqual(node(M, 0, 0)); // both whole → the matrix
    // Out-of-range wording is shared, not merely the code.
    expect(ev("INDEX(m, 9, 1)", { m: M })).toEqual(node(M, 9, 1));
    expect(code(ev("INDEX(m, 9, 1)", { m: M }))).toBe("#REF!");
  });

  it("TAKE / DROP share the signed kernel with all three nodes", async () => {
    const { ListTakeDropNode } = await import("./nodes/list");
    const { TableTakeDropNode } = await import("./nodes/matrix");
    const x = [1, 2, 3, 4];
    expect(ev("TAKE(x, 2)", { x })).toEqual(new ListTakeDropNode({ op: "take", dir: "first" }).data({ list: [x], count: [2] }).result);
    expect(ev("TAKE(x, -2)", { x })).toEqual(new ListTakeDropNode({ op: "take", dir: "last" }).data({ list: [x], count: [2] }).result);
    expect(ev("DROP(x, 1)", { x })).toEqual(new ListTakeDropNode({ op: "drop", dir: "first" }).data({ list: [x], count: [1] }).result);
    const m = [[1, 2, 3], [4, 5, 6]];
    expect(ev("TAKE(m, 1, 2)", { m }))
      .toEqual(new TableTakeDropNode({ op: "take" }).data({ matrix: [m], rows: [1], cols: [2] }).result);
    expect(ev("DROP(m, 1, -1)", { m }))
      .toEqual(new TableTakeDropNode({ op: "drop" }).data({ matrix: [m], rows: [1], cols: [-1] }).result);
  });

  it("FILTER by mask — Excel's include-array form", () => {
    // The List Filter NODE is condition-ROW configured (per-row {op, matchCase}
    // with wired comparison values) — a different mechanism from Excel's computed
    // boolean mask, so shareImpl's node-equality doesn't apply term-for-term here; the
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

// ─── INTERPOLATE grid mode: the last name D23 unblocked (shareImpl) ────────────────
// The node is ONE node with a List/Grid mode toggle, so it is ONE formula name —
// the arm is chosen by the first argument's RANK, not by a second registration
// (uniqueNameMap injectivity). Grid mode was parked behind the D2 cap; D23 lifted it.
describe("INTERPOLATE dispatches its two modes on the argument's rank", () => {
  const grid = [
    [null, 0,    10],
    [0,    0,    10],
    [10,   null, null],
    [20,   20,   30],
  ];

  it("a MATRIX first argument runs the node's grid fill, cell for cell", () => {
    const node = new InterpolateNode({ mode: "grid" });
    const nodeOut = node.data({ grid: [grid] }).result;
    expect(ev("INTERPOLATE(t)", { t: grid })).toEqual(nodeOut);
  });

  it("the optional second argument is grid mode's Forecast flag", () => {
    const off = new InterpolateNode({ mode: "grid", forecast: false });
    expect(ev("INTERPOLATE(t, FALSE)", { t: grid })).toEqual(off.data({ grid: [grid] }).result);
    // Omitted ⇒ on, matching the node's default.
    const on = new InterpolateNode({ mode: "grid" });
    expect(ev("INTERPOLATE(t)", { t: grid })).toEqual(on.data({ grid: [grid] }).result);
  });

  it("a rank-≤1 first argument still runs LIST mode, unchanged", () => {
    expect(ev("INTERPOLATE(y, x, q)", { y: [10, 20, 30], x: [1, 2, 3], q: [1.5] })).toEqual([15]);
    expect(ev("INTERPOLATE(y, x, q)", { y: [10, 20, 30], x: [1, 2, 3], q: 2 })).toBe(20);
  });

  it("the wrong arity for each arm is a #VALUE!, never a silent wrong mode", () => {
    expect(code(ev("INTERPOLATE(t, TRUE, 1)", { t: grid }))).toBe("#VALUE!"); // grid + 3 args
    expect(code(ev("INTERPOLATE(y, x)", { y: [1, 2], x: [1, 2] }))).toBe("#VALUE!"); // list, no query
  });

  it("a per-cell error reads as a HOLE to fill, exactly as the node treats it", () => {
    const dirty = grid.map((r) => [...r]);
    dirty[2][1] = "oops" as unknown as number; // a dirty cell is a blank, not poison
    const node = new InterpolateNode({ mode: "grid" });
    expect(ev("INTERPOLATE(t)", { t: dirty })).toEqual(node.data({ grid: [dirty] }).result);
  });
});
