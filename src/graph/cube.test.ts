import { describe, it, expect } from "vitest";
import {
  isCubeValue,
  cubeRowCount,
  cubeDepth,
  frameToCube,
  cubeFromRows,
  cubeFromColumns,
  toCube,
  buildFrame,
  isFrameValue,
  inferColumn,
  type CubeValue,
} from "./frame";
import { isUnitCell, magnitudeOf, type UnitCell } from "./unitValue";

// The Cube is the lattice supremum — a frame whose cells hold ANY value (a scalar,
// a list, a matrix, a nested frame, or another cube). This locks the value model +
// the runtime widening (toCube), the mirror of the socket-level rule that every
// value flows UP into a cube (see socketConnect.test.ts "cube" block). No node emits
// a cube yet — this is the inert foundation, like the logical family's 5a slice.

describe("CubeValue model", () => {
  it("brands + detects a cube (distinct from a frame)", () => {
    const c = cubeFromRows([[1, 2], [3, 4]]);
    expect(isCubeValue(c)).toBe(true);
    expect(isFrameValue(c)).toBe(false);
    expect(isCubeValue(buildFrame([[1]]))).toBe(false);
    expect(isCubeValue(null)).toBe(false);
    expect(isCubeValue(42)).toBe(false);
  });

  it("row count is the longest column", () => {
    const c: CubeValue = cubeFromColumns([
      { name: "a", cells: [1, 2, 3] },
      { name: "b", cells: [9] },
    ]);
    expect(cubeRowCount(c)).toBe(3);
  });

  it("cubeFromRows names + pads ragged rows with null", () => {
    const c = cubeFromRows([[1, 2, 3], [4]]);
    expect(c.columns.map((col) => col.name)).toEqual(["Col1", "Col2", "Col3"]);
    expect(c.columns[1].cells).toEqual([2, null]);
    expect(c.columns[2].cells).toEqual([3, null]);
  });

  it("cubeFromColumns de-dupes blank/duplicate names like the frame builders", () => {
    const c = cubeFromColumns([{ cells: [1] }, { name: "x", cells: [2] }, { name: "x", cells: [3] }]);
    expect(c.columns.map((col) => col.name)).toEqual(["Col1", "x", "x2"]);
  });
});

describe("cube cells hold any value (recursive)", () => {
  it("a cell can be a nested frame and another cube", () => {
    const innerFrame = buildFrame([[1, 2]], ["p", "q"]);
    const innerCube = cubeFromRows([[7]]);
    const c = cubeFromColumns([{ name: "nested", cells: [innerFrame, innerCube, [1, 2, 3]] }]);
    expect(isFrameValue(c.columns[0].cells[0])).toBe(true);
    expect(isCubeValue(c.columns[0].cells[1])).toBe(true);
    expect(c.columns[0].cells[2]).toEqual([1, 2, 3]); // a list cell
  });
});

describe("cube depth — cached, counts cube-in-cube nesting only", () => {
  it("a flat cube (no cube cells) is depth 1", () => {
    expect(cubeDepth(cubeFromRows([[1, 2], [3, 4]]))).toBe(1);
  });

  it("a nested FRAME is a leaf — it doesn't add depth", () => {
    const c = cubeFromColumns([{ name: "x", cells: [buildFrame([[1, 2]], ["p", "q"])] }]);
    expect(cubeDepth(c)).toBe(1);
  });

  it("a cube holding a cube is depth 2", () => {
    const inner = cubeFromRows([[7]]); // depth 1
    const c = cubeFromColumns([{ name: "n", cells: [1, inner, 3] }]);
    expect(cubeDepth(c)).toBe(2);
  });

  it("depth keeps climbing with each cube layer (3, then 4)", () => {
    const d1 = cubeFromRows([[0]]);
    const d2 = cubeFromColumns([{ name: "a", cells: [d1] }]);
    const d3 = cubeFromColumns([{ name: "a", cells: [d2] }]);
    const d4 = cubeFromColumns([{ name: "a", cells: [d3] }]);
    expect([d1, d2, d3, d4].map(cubeDepth)).toEqual([1, 2, 3, 4]);
  });

  it("takes the DEEPEST branch across cells, not the first", () => {
    const shallow = cubeFromRows([[1]]);                       // depth 1
    const deep = cubeFromColumns([{ name: "a", cells: [shallow] }]); // depth 2
    const c = cubeFromColumns([{ name: "mix", cells: [shallow, deep] }]);
    expect(cubeDepth(c)).toBe(3); // 1 + max(1, 2)
  });

  it("fans through a list/matrix cell to find a cube inside it", () => {
    const inner = cubeFromRows([[9]]); // depth 1
    const c = cubeFromColumns([{ name: "list", cells: [[1, 2, inner]] }]); // a cube buried in a list cell
    expect(cubeDepth(c)).toBe(2);
  });

  it("computes bottom-up — a parent reads its child's cached depth", () => {
    const child = cubeFromColumns([{ name: "a", cells: [cubeFromRows([[1]])] }]); // depth 2
    expect(child.depth).toBe(2); // cached on the value itself
    const parent = cubeFromColumns([{ name: "b", cells: [child] }]);
    expect(parent.depth).toBe(3);
  });
});

describe("toCube — every value widens UP into the supremum", () => {
  it("passes a cube through unchanged (identity)", () => {
    const c = cubeFromRows([[1]]);
    expect(toCube(c)).toBe(c);
  });

  it("a frame re-brands as a flat cube (cells preserved, columns kept)", () => {
    const f = buildFrame([[1, 2], [3, 4]], ["a", "b"]);
    const c = toCube(f);
    expect(isCubeValue(c)).toBe(true);
    expect(c.columns.map((col) => col.name)).toEqual(["a", "b"]);
    expect(c.columns[0].cells).toEqual([1, 3]);
    expect(c.columns[1].cells).toEqual([2, 4]);
  });

  it("a 2-D matrix → a grid of cells", () => {
    const c = toCube([[1, 2], [3, 4]]);
    expect(cubeRowCount(c)).toBe(2);
    expect(c.columns.length).toBe(2);
    expect(c.columns[0].cells).toEqual([1, 3]);
  });

  it("a 1-D list → a single ROW", () => {
    const c = toCube([10, 20, 30]);
    expect(cubeRowCount(c)).toBe(1);
    expect(c.columns.length).toBe(3);
    expect(c.columns.map((col) => col.cells[0])).toEqual([10, 20, 30]);
  });

  it("a scalar → a 1×1 cube", () => {
    const c = toCube(42);
    expect(c.columns.length).toBe(1);
    expect(cubeRowCount(c)).toBe(1);
    expect(c.columns[0].cells[0]).toBe(42);
  });
});

describe("frameToCube", () => {
  it("preserves column names + cell values, drops per-column type", () => {
    const f = buildFrame([[1], [2]], ["only"]);
    const c = frameToCube(f);
    expect(c.columns[0].name).toBe("only");
    expect(c.columns[0].cells).toEqual([1, 2]);
    expect("type" in c.columns[0]).toBe(false);
  });
});

describe("cube units — per-cell, like a list (D20)", () => {
  it("a unit-locked frame column flattens to per-cell UnitCells", () => {
    // "d (km)" locks the column to km; cells are as-typed (5, 10). frameToCube tags
    // each cell as a base-SI UnitCell carrying the display id — the unit rides the
    // value per-cell, exactly like a list.
    const f = buildFrame([[5], [10]], ["d (km)"]);
    const c = frameToCube(f);
    const cells = c.columns[0].cells;
    expect(cells.every((x) => isUnitCell(x))).toBe(true);
    expect((cells[0] as UnitCell).display).toBe("km");
    expect(magnitudeOf(cells[0])).toBeCloseTo(5000, 6); // base-SI (5 km = 5000 m)
    // A PLAIN column stays bare (no spurious tag).
    const plain = frameToCube(buildFrame([[1], [2]], ["n"]));
    expect(plain.columns[0].cells.every((x) => !isUnitCell(x))).toBe(true);
  });

  it("frame → cube → frame round-trips the unit (inferColumn recovers the ColumnUnit)", () => {
    const f = buildFrame([[5], [10]], ["d (km)"]);
    const cubeCells = frameToCube(f).columns[0].cells;
    const col = inferColumn("d", cubeCells);
    expect(col.type).toBe("number");
    expect(col.values).toEqual([5, 10]);        // back to as-typed magnitudes
    expect(col.unit?.display).toBe("km");        // unit recovered
  });
});
