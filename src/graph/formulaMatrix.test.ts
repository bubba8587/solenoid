import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";
import { EXCEL_IMPL_META } from "./excelFunctions";
import {
  MatDetNode, TableMultNode, TableTransposeNode, TableUnitNode, TableDiagNode, TableOuterNode, TableReshapeNode, TableInfoNode,
  HStackTableNode, VStackNode, TableSelectNode, ExpandNode,
} from "./nodes/matrix";
import { SeriesNode } from "./nodes/list";
import { InterpolateNode } from "./nodes/stats";
import { setCells } from "./nodes/matrixOps";
import { isSolError, type SolError } from "./errorValue";

// ─── matricesInFormulas tranche 1: the matrix core, node-equals-formula (shareImpl) ───────────────
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

  it("MUNIT off-diagonal blank fills nulls (stays out of counts), zero fills 0s", () => {
    const zero = new TableUnitNode({ offDiag: "zero" }).data({ n: [3] }).result as (number | null)[][];
    const blank = new TableUnitNode({ offDiag: "blank" }).data({ n: [3] }).result as (number | null)[][];
    expect(zero[0]).toEqual([1, 0, 0]);
    expect(blank[0]).toEqual([1, null, null]);
    // The claim: a blank off-diagonal is ABSENT, not a zero — so aggregators skip it.
    const present = (m: (number | null)[][]) => m.flat().filter((c) => c !== null).length;
    expect(present(zero)).toBe(9);  // every cell is a value
    expect(present(blank)).toBe(3); // only the three diagonal 1s count
  });

  it("DIAGONAL node — a list becomes a square matrix's diagonal (numpy.diag); off-diagonal 0 or blank", () => {
    const zero = new TableDiagNode({ offDiag: "zero" }).data({ diag: [[2, 5, 7]] }).result as (number | null)[][];
    expect(zero).toEqual([[2, 0, 0], [0, 5, 0], [0, 0, 7]]);
    const blank = new TableDiagNode({ offDiag: "blank" }).data({ diag: [[2, 5, 7]] }).result as (number | null)[][];
    expect(blank).toEqual([[2, null, null], [null, 5, null], [null, null, 7]]);
    // No list is an unknown diagonal, not a 0×0 matrix.
    expect(new TableDiagNode().data({}).result).toBeNull();
    // The DIAGONAL formula (off-diagonal 0; the blank toggle is node-only).
    expect(ev("DIAGONAL(x)", { x: [2, 5, 7] })).toEqual([[2, 0, 0], [0, 5, 0], [0, 0, 7]]);
  });

  it("OUTER node + formula — the matrix of products a[i]·b[j] (numpy.outer)", () => {
    const out = new TableOuterNode().data({ a: [[1, 2, 3]], b: [[10, 20]] }).result;
    expect(out).toEqual([[10, 20], [20, 40], [30, 60]]);
    expect(new TableOuterNode().data({ a: [[]], b: [[1]] }).result).toBeNull();
    expect(ev("OUTER(a, b)", { a: [1, 2], b: [3, 4, 5] })).toEqual([[3, 4, 5], [6, 8, 10]]);
  });

  it("WRAPROWS / WRAPCOLS — #N/A pads (appendLadder), pad_with overrides", () => {
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
    // Ragged inputs pad with #N/A (shape construction, appendLadder) — identical to the node.
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

describe("matricesInFormulas tranche 2 — the array-returning core, node-equals-formula", () => {
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

// ─── INTERPOLATE grid mode: the last name matricesInFormulas unblocked (shareImpl) ────────────────
// The node is ONE node with a List/Grid mode toggle, so it is ONE formula name —
// the arm is chosen by the first argument's RANK, not by a second registration
// (uniqueNameMap injectivity). Grid mode was parked behind the noFramesInFormulas cap; matricesInFormulas lifted it.
describe("INTERPOLATE dispatches its two modes on the argument's rank", () => {
  // Grid mode is now INTERPOLATE(table, xs?, ys?, forecast?) — coordinates ride beside Z.
  const z = [[0, 10], [null, null], [20, 30]];
  const xs = [0, 10];
  const ys = [0, 10, 20];

  it("a MATRIX first argument runs the node's grid fill, cell for cell", () => {
    const node = new InterpolateNode({ mode: "grid" });
    const nodeOut = node.data({ z: [z], xs: [xs], ys: [ys] }).result;
    expect(ev("INTERPOLATE(t, x, y)", { t: z, x: xs, y: ys })).toEqual(nodeOut);
  });

  it("the forecast flag is grid mode's LAST argument", () => {
    const off = new InterpolateNode({ mode: "grid", forecast: false });
    expect(ev("INTERPOLATE(t, x, y, FALSE)", { t: z, x: xs, y: ys })).toEqual(off.data({ z: [z], xs: [xs], ys: [ys] }).result);
    const on = new InterpolateNode({ mode: "grid" });
    expect(ev("INTERPOLATE(t, x, y)", { t: z, x: xs, y: ys })).toEqual(on.data({ z: [z], xs: [xs], ys: [ys] }).result);
  });

  it("omitted axes count 1, 2, 3…, matching the node with unwired axes", () => {
    const node = new InterpolateNode({ mode: "grid" });
    expect(ev("INTERPOLATE(t)", { t: z })).toEqual(node.data({ z: [z] }).result);
    // A BLANK positional axis is omitted too (a blank arg evaluates to null; the formula
    // surface has no wired-blank to propagate), so the forecast flag can be reached alone.
    const off = new InterpolateNode({ mode: "grid", forecast: false });
    expect(ev("INTERPOLATE(t, , , FALSE)", { t: z })).toEqual(off.data({ z: [z] }).result);
  });

  it("a rank-≤1 first argument still runs LIST mode, unchanged", () => {
    expect(ev("INTERPOLATE(y, x, q)", { y: [10, 20, 30], x: [1, 2, 3], q: [1.5] })).toEqual([15]);
    expect(ev("INTERPOLATE(y, x, q)", { y: [10, 20, 30], x: [1, 2, 3], q: 2 })).toBe(20);
  });

  it("a wrong-length axis is #SHAPE! (grid); a missing query is #VALUE! (list)", () => {
    expect(code(ev("INTERPOLATE(t, x)", { t: z, x: [1, 2, 3] }))).toBe("#SHAPE!"); // 3 Xs for 2 columns
    expect(code(ev("INTERPOLATE(y, x)", { y: [1, 2], x: [1, 2] }))).toBe("#VALUE!"); // list, no query
  });

  it("a per-cell error reads as a HOLE to fill, exactly as the node treats it", () => {
    const dirty = z.map((r) => [...r]);
    dirty[0][0] = "oops" as unknown as number; // a dirty cell is a blank, not poison
    const node = new InterpolateNode({ mode: "grid" });
    expect(ev("INTERPOLATE(t, x, y)", { t: dirty, x: xs, y: ys })).toEqual(node.data({ z: [dirty], xs: [xs], ys: [ys] }).result);
  });
});

// Set Cell has no formula (a variadic matrix writer has no clean signature) — the kernel
// is exercised directly. Node-level unit carry + wired-blank roles live in the node test.
describe("setCells kernel (Set Cell)", () => {
  const m = (): (number | null)[][] => [[1, 2], [3, 4]];

  it("writes a single cell by 1-based address", () => {
    expect(setCells(m(), [{ r: 1, c: 2, v: 9 }])).toEqual([[1, 9], [3, 4]]);
  });

  it("applies writes in row order — a later write wins on the same address", () => {
    expect(setCells(m(), [{ r: 2, c: 1, v: 7 }, { r: 2, c: 1, v: 8 }])).toEqual([[1, 2], [8, 4]]);
  });

  it("errors the whole result #REF! on an out-of-range row or column (shared wording)", () => {
    const badRow = setCells(m(), [{ r: 3, c: 1, v: 0 }]);
    expect(isSolError(badRow)).toBe(true);
    expect((badRow as SolError).code).toBe("#REF!");
    expect((badRow as SolError).message).toContain("Row 3 is outside 1");
    const badCol = setCells(m(), [{ r: 1, c: 5, v: 0 }]);
    expect((badCol as SolError).code).toBe("#REF!");
    expect((badCol as SolError).message).toContain("Column 5 is outside 1");
  });

  it("normalizes a ragged input to a full grid (missing cells blank) before writing", () => {
    expect(setCells([[1, 2], [3]], [{ r: 2, c: 2, v: 9 }])).toEqual([[1, 2], [3, 9]]);
  });

  it("a blank write value writes null — a Value is an operand, not an address", () => {
    expect(setCells(m(), [{ r: 1, c: 1, v: null }])).toEqual([[null, 2], [3, 4]]);
  });

  // Extends by SHAPE from the anchor: scalar → cell, list → row segment, matrix → block.
  const m3 = (): (number | null)[][] => [[1, 2, 3], [4, 5, 6], [7, 8, 9]];

  it("a 1-D list writes a rightward row segment from the anchor", () => {
    expect(setCells(m3(), [{ r: 2, c: 2, v: [10, 20] }])).toEqual([[1, 2, 3], [4, 10, 20], [7, 8, 9]]);
  });

  it("a 2-D matrix writes a block (numpy A[r:r+h, c:c+w] = B)", () => {
    expect(setCells(m3(), [{ r: 1, c: 1, v: [[10, 20], [30, 40]] }]))
      .toEqual([[10, 20, 3], [30, 40, 6], [7, 8, 9]]);
  });

  it("a block that runs off the bottom errors #REF! naming the Row axis (no clipping)", () => {
    const e = setCells(m3(), [{ r: 3, c: 1, v: [[1], [2]] }]); // 2 tall from row 3 → row 4
    expect(isSolError(e)).toBe(true);
    expect((e as SolError).code).toBe("#REF!");
    expect((e as SolError).message).toContain("Row 4 is outside 1");
  });

  it("a segment that runs off the right edge errors #REF! naming the Column axis", () => {
    const e = setCells(m3(), [{ r: 1, c: 2, v: [10, 20, 30] }]); // 3 wide from col 2 → col 4
    expect((e as SolError).code).toBe("#REF!");
    expect((e as SolError).message).toContain("Column 4 is outside 1");
  });

  it("later writes win cell-by-cell on an overlapping block", () => {
    // a 2×2 block, then a scalar over its top-left — only that one cell changes.
    expect(setCells(m3(), [{ r: 1, c: 1, v: [[10, 20], [30, 40]] }, { r: 1, c: 1, v: 99 }]))
      .toEqual([[99, 20, 3], [30, 40, 6], [7, 8, 9]]);
  });

  it("an empty list is a no-op after a valid anchor", () => {
    expect(setCells(m3(), [{ r: 2, c: 2, v: [] }])).toEqual(m3());
  });
});
