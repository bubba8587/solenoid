// [[B11]] maximalMerge, [[C17]] shareImpl
// The Grid modes of Smooth, Convolve and Integrate: List mode keeps the sockets it always had, Grid mode swaps in a
// table, the card answers what its formula answers, and the mode survives a save.
import { describe, it, expect } from "vitest";
import { SmoothNode, ConvolveNode, TrapzNode, DiffNode, RandArrayNode, FindPeaksNode, ConnectedRegionsNode } from "../../../src/graph/nodes/list";
import { InterpolateNode, TableMultNode, MatEigenNode, MatDetNode, TableTransposeNode } from "../../../src/graph/nodeClasses";
import { ReverseNode } from "../../../src/graph/nodes/list";
import { extractInit } from "../../../src/graph/nodeInit";
import { coreFunction } from "../coreFunction";
import { inEditor, Src } from "../cardPasses";
import { withMatrixUnit, matrixUnitOf } from "../../../src/graph/unitValue";

const GRID = [[3, 1, 4, 1, 5], [9, 2, 6, 5, 3], [5, 8, 9, 7, 9], [3, 2, 3, 8, 4]];

async function answer(node: { outputs: Record<string, unknown> }, wires: Record<string, unknown>) {
  const ed = await inEditor(node as never);
  for (const [key, value] of Object.entries(wires)) await ed.wire(new Src(value, "table"), key);
  const r = await ed.pass("result");
  ed.dispose();
  return r;
}

describe("List mode keeps its sockets", () => {
  it("as before Grid mode existed", () => {
    expect(Object.keys(new SmoothNode().inputs)).toEqual(["list", "window", "order"]);
    expect(Object.keys(new ConvolveNode().inputs)).toEqual(["a", "b"]);
    expect(Object.keys(new TrapzNode().inputs)).toEqual(["list", "dx"]);
    expect(Object.keys(new DiffNode().inputs)).toEqual(["list"]);
    expect(Object.keys(new RandArrayNode().inputs)).toEqual(["count", "min", "max"]);
  });
});

describe("Grid mode", () => {
  it("swaps the list for a table and back", () => {
    const n = new TrapzNode({ mode: "grid" });
    expect(Object.keys(n.inputs)).toEqual(["grid", "dx", "dy"]);
    expect(n.literals.dy).toBe(1);
    n.mode = "list";
    n._rebuildSockets();
    expect(Object.keys(n.inputs)).toEqual(["list", "dx"]);
    n.mode = "grid";
    n._rebuildSockets();
    expect(n.literals.dy).toBe(1); // a round trip keeps what was typed
  });

  it("offers only the smoothers that work on a grid", () => {
    expect(new SmoothNode({ op: "savgol", mode: "grid" }).op).toBe("gaussian");
    expect(new SmoothNode({ op: "median", mode: "grid" }).op).toBe("median");
    expect(Object.keys(new SmoothNode({ op: "mean", mode: "grid" }).inputs)).toEqual(["grid", "size"]);
  });

  it("smooths a grid as MEDIANSMOOTH does", async () => {
    const card = await answer(new SmoothNode({ op: "median", mode: "grid" }), { grid: GRID });
    expect(card).toEqual(coreFunction("MEDIANSMOOTH")!(GRID, 3));
    expect((card as number[][])[3]).toEqual([3, 3, 7, 7, 7]);
  });

  it("smooths a grid in the grid's unit", async () => {
    const km = withMatrixUnit(GRID.map((r) => [...r]), { dim: { length: 1 }, display: "km" });
    expect(matrixUnitOf(await answer(new SmoothNode({ op: "gaussian", mode: "grid" }), { grid: km }))).toMatchObject({ display: "km" });
  });

  it("convolves a grid by a kernel, keeping the shape it's set to", async () => {
    const kernel = [[1, 2], [0, -1], [1, 1]];
    const card = await answer(new ConvolveNode({ mode: "grid", form: "valid" }), { a: GRID, b: kernel });
    expect(card).toEqual([[13, 28, 24, 24], [14, 7, 16, 21]]);
  });

  it("integrates a grid at its dx and dy", async () => {
    const n = new TrapzNode({ mode: "grid" });
    n.literals = { dx: 0.5, dy: 2 };
    expect(await answer(n, { grid: GRID })).toBe(63.25);
  });

  it("takes differences and slopes down the rows or across the columns, as numpy's axis 0 and 1", async () => {
    expect(await answer(new DiffNode({ mode: "grid" }), { grid: GRID })).toEqual([[6, 1, 2, 4, -2], [-4, 6, 3, 2, 6], [-2, -6, -6, 1, -5]]);
    const across = await answer(new DiffNode({ op: "gradient", mode: "grid", byCol: true }), { grid: GRID }) as number[][];
    expect(across[0]).toEqual([-2, 0.5, 0, 0.5, 4]);
    expect(extractInit(new DiffNode({ op: "percent", mode: "grid", byCol: true }))).toMatchObject({ op: "percent", mode: "grid", byCol: true });
  });

  it("draws a Rows by Columns table, as RANDARRAY(rows, columns, min, max, whole_number) does", async () => {
    const n = new RandArrayNode({ mode: "grid", integer: true });
    n.literals = { rows: 3, cols: 4, min: 1, max: 6 };
    const ed = await inEditor(n as never);
    const t = await ed.pass("table") as number[][];
    ed.dispose();
    expect(t.length).toBe(3);
    expect(t.every((r) => r.length === 4 && r.every((v) => Number.isInteger(v) && v >= 1 && v <= 6))).toBe(true);
  });

  it("takes the Laplacian over both axes, as scipy's ndimage.laplace", async () => {
    const lap = await answer(new DiffNode({ op: "laplacian", mode: "grid" }), { grid: GRID }) as number[][];
    expect(lap[0]).toEqual([4, 6, -4, 11, -6]);
  });

  it("finds the cells above every neighbor, with their heights", async () => {
    const peaks = await answer(new FindPeaksNode({ mode: "grid" }), { grid: [[0, 1, 0], [1, 5, 1], [0, 1, 9]] }) as { columns: { name: string; values: unknown[] }[] };
    expect(peaks.columns.map((c) => [c.name, c.values])).toEqual([["Row", [3]], ["Column", [3]], ["Height", [9]]]);
  });

  it("numbers the patches of touching cells, corners joining only when asked", async () => {
    const m = [[1, 0, 2], [0, 1, 0]];
    expect(await answer(new ConnectedRegionsNode(), { grid: m })).toEqual([[1, 0, 2], [0, 3, 0]]);
    expect(await answer(new ConnectedRegionsNode({ diagonal: true }), { grid: m })).toEqual([[1, 0, 1], [0, 1, 0]]);
  });

  it("spreads scattered points onto a grid by INTERPOLATE's Points mode", async () => {
    const n = new InterpolateNode({ mode: "points", method: "nearest" });
    n.stringLiterals = { gx: "0, 2", gy: "0, 2" };
    const t = await answer(n, { xs: [0, 2, 0, 2], ys: [0, 0, 2, 2], zs: [1, 2, 3, 4] });
    expect(t).toEqual([[1, 2], [3, 4]]);
  });

  it("flips a grid down or across, and turns it a quarter at a time", async () => {
    const r = [[1, 2, 3], [4, 5, 6]];
    expect(await answer(new ReverseNode({ mode: "grid" }), { grid: r })).toEqual([[4, 5, 6], [1, 2, 3]]);
    expect(await answer(new ReverseNode({ mode: "grid", byCol: true }), { grid: r })).toEqual([[3, 2, 1], [6, 5, 4]]);
    expect(await answer(new TableTransposeNode({ op: "rot90" }), { matrix: r })).toEqual([[3, 6], [2, 5], [1, 4]]);
    expect(Object.keys(new TableTransposeNode().inputs)).toEqual(["matrix"]);
  });

  it("takes a Kronecker product, a pseudo-inverse and singular values on the matrix cards", async () => {
    expect(await answer(new TableMultNode({ op: "kron" }), { a: [[1, 2]], b: [[1], [10]] })).toEqual([[1, 2], [10, 20]]);
    const p = await answer(new MatDetNode({ op: "pinv" }), { matrix: [[2, 0], [0, 4], [0, 0]] }) as number[][];
    expect(p.map((row) => row.map((x) => +x.toFixed(12)))).toEqual([[0.5, 0, 0], [0, 0.25, 0]]);
    const ed = await inEditor(new MatEigenNode({ op: "svd" }) as never);
    await ed.wire(new Src([[3, 0], [0, 4]], "table"), "matrix");
    expect(await ed.pass("values")).toEqual([4, 3]);
    ed.dispose();
  });

  it("keeps its mode and shape through a save", () => {
    expect(extractInit(new SmoothNode({ op: "mean", mode: "grid" }))).toMatchObject({ op: "mean", mode: "grid" });
    expect(extractInit(new ConvolveNode({ mode: "grid", form: "same" }))).toMatchObject({ mode: "grid", form: "same" });
    expect(new ConvolveNode({ form: "sideways" as never }).form).toBe("full");
  });
});
