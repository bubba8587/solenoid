import { describe, it, expect } from "vitest";
import {
  buildFrame, isCubeValue, isFrameValue, cubeDepth, cubeRowCount, frameRowCount,
  relateFramesToCube, relateCubeToFrame, type CubeValue, type FrameValue,
} from "./frame";
import { BuildCubeNode, NestJoinNode, CubeColumnsNode } from "./nodes/cube";
import { ListIndexNode } from "./nodes/list";
import { isSolError } from "./errorValue";

// The Cube producers (Build Cube, Relate) + the cube/frame-aware INDEX accessor.
// These exercise the node data() methods directly (the engine's error-guard wrap
// isn't applied to a bare call), like the other node unit tests.

describe("relateFramesToCube — nest two frames on a key", () => {
  const parent = buildFrame([[1], [2], [3]], ["id"]);
  const child = buildFrame([[1, 10], [1, 20], [2, 30]], ["id", "amt"]);

  it("nests matching child rows under each parent row as a sub-frame", () => {
    const cube = relateFramesToCube(parent, child, "id", "orders")!;
    expect(isCubeValue(cube)).toBe(true);
    expect(cube.columns.map((c) => c.name)).toEqual(["id", "orders"]);
    expect(cubeRowCount(cube)).toBe(3);
    // The nested cells are FRAMES, which are leaves — a cube of frames is depth 1
    // (only a cube nested in a cube grows depth). Relate a cube child to go deeper.
    expect(cubeDepth(cube)).toBe(1);
    const o0 = cube.columns[1].cells[0];
    expect(isFrameValue(o0)).toBe(true);
    expect(frameRowCount(o0 as never)).toBe(2); // id=1 matched two child rows
    expect(frameRowCount(cube.columns[1].cells[1] as never)).toBe(1); // id=2 matched one
  });

  it("keeps every parent row — a no-match parent gets an empty sub-frame", () => {
    const cube = relateFramesToCube(parent, child, "id", "orders")!;
    const o2 = cube.columns[1].cells[2]; // id=3, no children
    expect(isFrameValue(o2)).toBe(true);
    expect(frameRowCount(o2 as never)).toBe(0);
  });

  it("dedupes the nested column name against a parent column", () => {
    const cube = relateFramesToCube(parent, child, "id", "id")!;
    expect(cube.columns.map((c) => c.name)).toEqual(["id", "id2"]);
  });

  it("returns null when either frame lacks the key column", () => {
    expect(relateFramesToCube(parent, child, "missing", "x")).toBeNull();
  });
});

describe("NestJoinNode.data", () => {
  it("builds a cube from wired parent/child + a key literal", () => {
    const n = new NestJoinNode();
    n.stringLiterals.key = "id";
    n.stringLiterals.name = "orders";
    const parent = buildFrame([[1], [2]], ["id"]);
    const child = buildFrame([[1, 10], [2, 20]], ["id", "amt"]);
    const { cube } = n.data({ parent: [parent], child: [child] });
    expect(isCubeValue(cube)).toBe(true);
    expect((cube as CubeValue).columns.map((c) => c.name)).toEqual(["id", "orders"]);
  });

  it("is empty until parent, child, and key are all present", () => {
    const n = new NestJoinNode();
    expect(n.data({ parent: [buildFrame([[1]], ["id"])] }).cube).toBeNull();
  });

  it("accepts a CUBE child — nests a pre-built cube whole under each parent", () => {
    // ordersCube: orders (with a customer key) each carrying nested line items.
    const orders = buildFrame([[10, 1], [20, 1], [30, 2]], ["ord", "cust"]);
    const lineItems = buildFrame([[10, 1], [10, 2], [20, 3]], ["ord", "sku"]);
    const ordersCube = relateFramesToCube(orders, lineItems, "ord", "lines")!;
    const customers = buildFrame([[1], [2]], ["cust"]);
    const n = new NestJoinNode();
    n.stringLiterals.key = "cust";
    n.stringLiterals.name = "orders";
    const { cube } = n.data({ parent: [customers], child: [ordersCube] });
    expect(isCubeValue(cube)).toBe(true);
    // each customer's nested cell is a sub-CUBE (not a flat sub-frame)
    expect(isCubeValue((cube as CubeValue).columns[1].cells[0])).toBe(true);
  });
});

describe("relateFramesToCube — CUBE child (nest a pre-built cube whole)", () => {
  // A pre-built Orders cube: orders keyed by customer, each carrying nested line items.
  const orders = buildFrame([[10, 1], [20, 1], [30, 2]], ["ord", "cust"]);
  const lineItems = buildFrame([[10, 1], [10, 2], [20, 3]], ["ord", "sku"]);
  const ordersCube = relateFramesToCube(orders, lineItems, "ord", "lines")!; // cube [ord, cust, lines(frame)]
  const customers = buildFrame([[1], [2], [3]], ["cust"]);

  it("nests a sub-CUBE under each parent, preserving the child's own nesting (Customer→Order→LineItem in one step)", () => {
    const cube = relateFramesToCube(customers, ordersCube, "cust", "orders")!;
    expect(cube.columns.map((c) => c.name)).toEqual(["cust", "orders"]);
    const c1 = cube.columns[1].cells[0]; // cust=1 → a sub-cube of orders 10 & 20
    expect(isCubeValue(c1)).toBe(true);
    expect(cubeRowCount(c1 as CubeValue)).toBe(2);
    // depth 2: a nested FRAME (lines) is a leaf (adds no depth); only the cube-in-cube
    // (customers holding order-cubes) counts — so customers(1) over orders-cube(1) = 2.
    expect(cubeDepth(cube)).toBe(2);
  });

  it("a no-match parent gets an EMPTY sub-cube (0 rows), structure preserved", () => {
    const cube = relateFramesToCube(customers, ordersCube, "cust", "orders")!;
    const c3 = cube.columns[1].cells[2]; // cust=3, no orders
    expect(isCubeValue(c3)).toBe(true);
    expect(cubeRowCount(c3 as CubeValue)).toBe(0);
  });

  it("a flat FRAME child still nests a sub-FRAME (unchanged) — depth 1", () => {
    const flat = relateFramesToCube(customers, orders, "cust", "orders")!;
    expect(isFrameValue(flat.columns[1].cells[0])).toBe(true);
    expect(cubeDepth(flat)).toBe(1);
  });
});

describe("relateCubeToFrame — a CUBE child deepens a cube parent's leaves", () => {
  it("nest-joins a cube child into each leaf frame → the leaf gains a nested sub-cube", () => {
    // Parent cube: customers → flat order sub-frames.
    const customers = buildFrame([[1], [2]], ["cust"]);
    const orders = buildFrame([[10, 1], [20, 2]], ["ord", "cust"]);
    const parentCube = relateFramesToCube(customers, orders, "cust", "orders")!;
    // Cube child keyed on "ord" (a line-items cube).
    const lineItems = buildFrame([[10, 1], [20, 2]], ["ord", "sku"]);
    const childCube = relateFramesToCube(lineItems, buildFrame([[10, 99]], ["ord", "note"]), "ord", "notes")!;
    const deepened = relateCubeToFrame(parentCube, childCube, "ord", "lines");
    // Each customer's order sub-frame became a sub-cube whose orders carry a nested "lines" cube.
    const ordersCell = deepened.columns[1].cells[0];
    expect(isCubeValue(ordersCell)).toBe(true);
    const linesCol = (ordersCell as CubeValue).columns.find((c) => c.name === "lines");
    expect(linesCol).toBeDefined();
    expect(isCubeValue(linesCol!.cells[0])).toBe(true); // the child was a cube → nested as a sub-cube
  });
});

describe("BuildCubeNode.data — any value into a cell", () => {
  it("collects a typed scalar, a wired frame, and an empty into one column", () => {
    const n = new BuildCubeNode();
    const keys = n.valueInputKeys();
    expect(keys.length).toBe(3);
    n.literals[keys[0]] = 5;                 // typed scalar cell
    const frame = buildFrame([[1, 2]], ["a", "b"]);
    const { cube } = n.data({ [keys[1]]: [frame] }); // wired frame cell; keys[2] empty
    const c = cube as CubeValue;
    expect(c.columns.length).toBe(1);
    expect(c.columns[0].name).toBe("Items");
    expect(c.columns[0].cells[0]).toBe(5);
    expect(isFrameValue(c.columns[0].cells[1])).toBe(true);
    expect(c.columns[0].cells[2]).toBeNull();
    expect(cubeRowCount(c)).toBe(3);
  });

  it("a wired cube cell makes the result depth 2; name comes from the input", () => {
    const n = new BuildCubeNode();
    const keys = n.valueInputKeys();
    const inner = new BuildCubeNode().data({}).cube as CubeValue; // a flat cube (depth 1)
    const { cube } = n.data({ name: ["Nested"], [keys[0]]: [inner] });
    const c = cube as CubeValue;
    expect(c.columns[0].name).toBe("Nested");
    expect(isCubeValue(c.columns[0].cells[0])).toBe(true);
    expect(cubeDepth(c)).toBe(2);
  });
});

describe("ListIndexNode (INDEX) — reads a cell out of any container", () => {
  it("1-D list: the nth value (Excel INDEX(array, n))", () => {
    const n = new ListIndexNode();
    n.literals.index = 2;
    expect(n.data({ list: [[10, 20, 30]] }).result).toBe(20);
  });

  it("2-D matrix: the (row, column) cell", () => {
    const n = new ListIndexNode();
    expect(n.data({ list: [[[1, 2], [3, 4]]], index: [2], column: [1] }).result).toBe(3);
  });

  it("frame: the cell at (row, column)", () => {
    const n = new ListIndexNode();
    const frame = buildFrame([[1, 2], [3, 4]], ["a", "b"]);
    expect(n.data({ list: [frame], index: [2], column: [2] }).result).toBe(4);
  });

  it("cube: a nested-frame cell comes out WHOLE (as a frame)", () => {
    const cube = relateFramesToCube(
      buildFrame([[1], [2]], ["id"]),
      buildFrame([[1, 10], [2, 20]], ["id", "amt"]),
      "id", "orders",
    )!;
    const n = new ListIndexNode();
    const out = n.data({ list: [cube], index: [1], column: [2] }).result; // the nested column
    expect(isFrameValue(out)).toBe(true);
    expect(frameRowCount(out as never)).toBe(1);
  });

  it("out-of-range index is #REF!", () => {
    const n = new ListIndexNode();
    const r = n.data({ list: [[1, 2]], index: [9] }).result;
    expect(isSolError(r) && r.code).toBe("#REF!");
  });

  // ── the Excel whole-axis form: blank/0 Row = whole column, blank/0 Column = whole row ──

  it("matrix: blank Column slices the WHOLE ROW; blank Row slices the WHOLE COLUMN", () => {
    const grid = [[1, 2], [3, 4]];
    expect(new ListIndexNode().data({ list: [grid], index: [2] }).result).toEqual([3, 4]);
    expect(new ListIndexNode().data({ list: [grid], column: [2] }).result).toEqual([2, 4]);
    // Explicit 0 behaves exactly like blank (Excel INDEX(range, 0, col)).
    expect(new ListIndexNode().data({ list: [grid], index: [0], column: [1] }).result).toEqual([1, 3]);
    expect(new ListIndexNode().data({ list: [grid], index: [1], column: [0] }).result).toEqual([1, 2]);
  });

  it("both blank passes the container through whole (fresh node = [all]/[all] defaults)", () => {
    const grid = [[1, 2], [3, 4]];
    expect(new ListIndexNode().data({ list: [grid] }).result).toEqual(grid);
    expect(new ListIndexNode().data({ list: [[10, 20, 30]] }).result).toEqual([10, 20, 30]);
    expect(new ListIndexNode().data({ list: [7] }).result).toBe(7);
  });

  it("frame: blank Row = the column as a values LIST; blank Column = a ONE-ROW FRAME", () => {
    const frame = buildFrame([[1, 2], [3, 4]], ["a", "b"]);
    expect(new ListIndexNode().data({ list: [frame], column: [2] }).result).toEqual([2, 4]);
    const row = new ListIndexNode().data({ list: [frame], index: [2] }).result;
    expect(isFrameValue(row)).toBe(true);
    expect(frameRowCount(row as never)).toBe(1);
    expect((row as FrameValue).columns.map((c) => c.values[0])).toEqual([3, 4]);
  });

  it("cube: slices stay CUBES so nested cells survive whole", () => {
    const cube = relateFramesToCube(
      buildFrame([[1], [2]], ["id"]),
      buildFrame([[1, 10], [2, 20]], ["id", "amt"]),
      "id", "orders",
    )!;
    const col = new ListIndexNode().data({ list: [cube], column: [2] }).result; // the nested column, whole
    expect(isCubeValue(col)).toBe(true);
    expect((col as CubeValue).columns).toHaveLength(1);
    expect(isFrameValue((col as CubeValue).columns[0].cells[0])).toBe(true);
    const row = new ListIndexNode().data({ list: [cube], index: [1] }).result; // one-row cube
    expect(isCubeValue(row)).toBe(true);
    expect(cubeRowCount(row as CubeValue)).toBe(1);
    expect(isFrameValue((row as CubeValue).columns[1].cells[0])).toBe(true);
  });

  it("whole-axis slice bounds still #REF!", () => {
    const grid = [[1, 2], [3, 4]];
    const badCol = new ListIndexNode().data({ list: [grid], column: [9] }).result;
    expect(isSolError(badCol) && badCol.code).toBe("#REF!");
    const flatCol = new ListIndexNode().data({ list: [[10, 20]], column: [2] }).result;
    expect(isSolError(flatCol) && flatCol.code).toBe("#REF!"); // a flat list is n×1
  });
});

describe("relateCubeToFrame — deepen a nest-join cube one level (Customer→Order→LineItem)", () => {
  const customer = buildFrame([[1], [2]], ["id"]);
  const order = buildFrame([[1, 100], [1, 101], [2, 102]], ["id", "orderId"]);
  const lineItem = buildFrame([[100, 1], [100, 2], [101, 3], [102, 4]], ["orderId", "item"]);

  it("nest-joins the child into each leaf sub-frame, growing depth 1 → 2", () => {
    const lvl1 = relateFramesToCube(customer, order, "id", "orders")!;
    expect(cubeDepth(lvl1)).toBe(1);
    const lvl2 = relateCubeToFrame(lvl1, lineItem, "orderId", "lines");
    expect(isCubeValue(lvl2)).toBe(true);
    expect(cubeDepth(lvl2)).toBe(2);                 // orders cells are now cubes
    expect(lvl2.columns.map((c) => c.name)).toEqual(["id", "orders"]);

    // Customer 1's "orders" cell is now a CUBE of its two orders, each with a "lines" sub-frame.
    const c1orders = lvl2.columns[1].cells[0];
    expect(isCubeValue(c1orders)).toBe(true);
    const oc = c1orders as CubeValue;
    expect(oc.columns.map((c) => c.name)).toEqual(["id", "orderId", "lines"]);
    expect(cubeRowCount(oc)).toBe(2);                // orders 100 and 101
    const order100lines = oc.columns[2].cells[0];    // lines for order 100
    expect(isFrameValue(order100lines)).toBe(true);
    expect(frameRowCount(order100lines as never)).toBe(2); // items 1 and 2
  });

  it("a cube with no nested sub-table column is returned unchanged", () => {
    const noNest = { __cube: true, depth: 1, columns: [{ name: "id", cells: [1, 2] }] } as unknown as CubeValue;
    expect(relateCubeToFrame(noNest, buildFrame([[1, 1]], ["id", "v"]), "id", "n")).toBe(noNest);
  });
});

describe("CubeColumnsNode — assemble a multi-column cube", () => {
  it("each input is a column: list → elements, single-col cube → its cells, padded to max", () => {
    // orders: a one-column cube of two frames (like a cell-wise Build Cube output).
    const bc = new BuildCubeNode();
    const bk = bc.valueInputKeys();
    const orders = bc.data({ [bk[0]]: [buildFrame([[1]], ["x"])], [bk[1]]: [buildFrame([[2]], ["x"])] }).cube;

    const n = new CubeColumnsNode();
    n.addValueInput();                       // 2 default → 3 columns
    const ck = n.valueInputKeys();
    const out = n.data({
      names: [["id", "name", "orders"]],
      [ck[0]]: [[1, 2, 3]],                  // list → 3 cells
      [ck[1]]: [["A", "B", "C"]],            // list → 3 cells
      [ck[2]]: [orders],                     // cube → its column's cells [f1, f2, null]
    }).cube as CubeValue;

    expect(isCubeValue(out)).toBe(true);
    expect(out.columns.map((c) => c.name)).toEqual(["id", "name", "orders"]);
    expect(cubeRowCount(out)).toBe(3);
    expect(out.columns[0].cells).toEqual([1, 2, 3]);
    expect(isFrameValue(out.columns[2].cells[0])).toBe(true); // a nested frame cell
    expect(out.columns[2].cells[2]).toBeNull();               // padded (orders had only 2)
  });

  it("a typed scalar on an unwired column is a single cell; auto-names missing headers", () => {
    const n = new CubeColumnsNode();
    const ck = n.valueInputKeys();
    n.literals[ck[0]] = 7;
    const out = n.data({ [ck[1]]: [[10, 20]] }).cube as CubeValue;
    expect(out.columns.map((c) => c.name)).toEqual(["Col1", "Col2"]); // no names given
    expect(out.columns[0].cells).toEqual([7, null]); // scalar → 1 cell, padded to len 2
    expect(out.columns[1].cells).toEqual([10, 20]);
  });
})
