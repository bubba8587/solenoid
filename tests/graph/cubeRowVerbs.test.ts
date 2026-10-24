// [[C24]] arraySemantics, [[C44]] dateSerials, [[C45]]
import { describe, it, expect } from "vitest";
import {
  cubeFromColumns, frameFromRows, frameToCube, isCubeValue,
  type CubeValue, type FrameValue,
} from "../../src/graph/frame";
import { type FilterCond, type FilterOp } from "../../src/graph/frameOps";
import { sortByColumn, distinctRows, sliceRows, filterRowsMulti } from "./coreVerbs";
import { isSolError } from "../../src/graph/errorValue";
import {
  ComputedColumnNode, AddColumnNode, SortFrameNode, DistinctNode, HeadNode, FilterFrameNode, WindowNode, type HeadOp, type WindowFn,
} from "../../src/graph/nodes/frame";

// A′: the row verbs take cubes. The cube path reorders/keeps WHOLE rows off the flat scalar
// columns, nested cells riding along, and the order is the frame path's.

const colCells = (c: CubeValue, name: string) => c.columns.find((k) => k.name === name)!.cells;
const colVals = (f: FrameValue, name: string) => f.columns.find((k) => k.name === name)!.values;
const codeOf = (v: unknown): string | null => (isSolError(v) ? v.code : null);

type Verb = { data(inputs: Record<string, unknown[]>): Promise<{ frame: unknown; dropped?: unknown }> };
async function run(n: Verb, cube: CubeValue): Promise<CubeValue> {
  return (await n.data({ frame: [cube] })).frame as CubeValue;
}
function sortCube(cube: CubeValue, by: string, dir: "asc" | "desc"): Promise<CubeValue> {
  const n = new SortFrameNode({ dir });
  n.stringLiterals.column = by;
  return run(n, cube);
}
function sliceCube(cube: CubeValue, op: HeadOp, rows: number, to?: number): Promise<CubeValue> {
  const n = new HeadNode({ op });
  n.literals.rows = rows;
  if (to !== undefined) n.literals.to = to;
  return run(n, cube);
}
/** Filter Frame over a cube with one condition per entry: its kept and dropped rows. */
async function filterCube(cube: CubeValue, conds: { column: string; op: FilterOp; value: string; matchCase?: boolean }[]) {
  const n = new FilterFrameNode({ valueKeys: conds.map((_, i) => `column${i}`) });
  conds.forEach((c, i) => {
    n.condConfig[String(i)] = { op: c.op, ...(c.matchCase ? { matchCase: true } : {}) };
    n.stringLiterals[`column${i}`] = c.column;
    n.stringLiterals[`value${i}`] = c.value;
  });
  const out = await n.data({ frame: [cube] });
  return { kept: out.frame as CubeValue, dropped: out.dropped as CubeValue };
}
function windowCube(cube: CubeValue, agg: WindowFn, column: string, name: string, n = 1): Promise<CubeValue> {
  const w = new WindowNode({ agg });
  w.stringLiterals.column = column;
  w.stringLiterals.name = name;
  w.literals.n = n;
  return run(w, cube);
}

// A cube with scalar columns, a list column (tags), and a nested sub-table column.
const sub0 = frameFromRows([[1], [2]], ["x"]);
const sub1 = frameFromRows([[9]], ["x"]);
function sampleCube(): CubeValue {
  return cubeFromColumns([
    { name: "name", cells: ["b", "a", "c"], type: "string" },
    { name: "priority", cells: [2, 1, 3], type: "number" },
    { name: "tags", cells: [["work", "home"], ["home"], []] },
    { name: "sub", cells: [sub0, sub1, sub0] },
  ]);
}

describe("sortCube", () => {
  it("sorts by a scalar column, order identical to the frame path", async () => {
    const f = frameFromRows([["b", 2], ["a", 1], ["c", 3]], ["name", "priority"]);
    const fc = frameToCube(f);
    for (const dir of ["asc", "desc"] as const) {
      const sf = sortByColumn(f, "priority", dir);
      const sc = await sortCube(fc, "priority", dir);
      expect(colCells(sc, "name")).toEqual(colVals(sf, "name"));
      expect(colCells(sc, "priority")).toEqual(colVals(sf, "priority"));
    }
  });
  it("carries whole rows: sorting by priority reorders the tags list cells too", async () => {
    const sc = await sortCube(sampleCube(), "priority", "asc");
    expect(colCells(sc, "name")).toEqual(["a", "b", "c"]);
    expect(colCells(sc, "tags")).toEqual([["home"], ["work", "home"], []]);
  });
  it("a list column is not sortable → #SHAPE!", async () => {
    expect(codeOf(await sortCube(sampleCube(), "tags", "asc"))).toBe("#SHAPE!");
  });
});

describe("Distinct over a cube", () => {
  it("dedupes flat rows identically to the frame path", async () => {
    const f = frameFromRows([["a", 1], ["a", 1], ["b", 2], ["a", 1]], ["name", "n"]);
    const fc = frameToCube(f);
    const df = distinctRows(f);
    const dc = await run(new DistinctNode(), fc);
    expect(colCells(dc, "name")).toEqual(colVals(df, "name"));
    expect(colCells(dc, "n")).toEqual(colVals(df, "n"));
  });
  it("keys on list and nested cells structurally", async () => {
    const c = cubeFromColumns([
      { name: "tags", cells: [["a", "b"], ["a", "b"], ["a"]] },
      { name: "sub", cells: [sub0, sub0, sub0] },
    ]);
    const d = await run(new DistinctNode(), c);
    // Rows 0 and 1 have equal tags + sub → row 1 drops; row 2 differs.
    expect(colCells(d, "tags")).toEqual([["a", "b"], ["a"]]);
  });
});

describe("Head over a cube", () => {
  it("first / last / skip / range windows match sliceRows", async () => {
    const f = frameFromRows([[10], [20], [30], [40], [50]], ["n"]);
    const fc = frameToCube(f);
    const cases: Array<["first" | "last" | "skip" | "range", number, number?]> = [
      ["first", 2], ["last", 2], ["skip", 3], ["range", 2, 4],
    ];
    for (const [mode, n, to] of cases) {
      const sf = sliceRows(f, mode, n, to);
      const sc = await sliceCube(fc, mode, n, to);
      expect(colCells(sc, "n")).toEqual(colVals(sf, "n"));
    }
  });
});

describe("Filter Frame over a cube — scalar ops match the frame path", () => {
  const f = frameFromRows([["b", 2], ["a", 1], ["c", 3]], ["name", "priority"]);
  const fc = frameToCube(f);
  it("a numeric condition keeps the same rows", async () => {
    const conds: FilterCond[] = [{ column: "priority", op: "gt", value: "1" }];
    const kf = filterRowsMulti(f, "and", conds);
    const { kept } = await filterCube(fc, [{ column: "priority", op: "gt", value: "1" }]);
    expect(colCells(kept, "name")).toEqual(colVals(kf, "name"));
  });
  it("the complement is the dropped rows", async () => {
    const { dropped } = await filterCube(fc, [{ column: "priority", op: "gt", value: "1" }]);
    expect(colCells(dropped, "name")).toEqual(["a"]);
  });
  it("a scalar op on a list column → #SHAPE!", async () => {
    const { kept } = await filterCube(sampleCube(), [{ column: "tags", op: "eq", value: "home" }]);
    expect(codeOf(kept)).toBe("#SHAPE!");
  });
});

describe("Filter Frame over a cube — list-cell ops (Bases)", () => {
  const c = sampleCube(); // tags: [["work","home"], ["home"], []]
  const keep = async (op: FilterOp, value: string, matchCase = false) =>
    colCells((await filterCube(c, [{ column: "tags", op, value, matchCase }])).kept, "name");

  it("listContains keeps rows whose tag list holds the value", async () => {
    expect(await keep("listContains", "home")).toEqual(["b", "a"]);
    expect(await keep("listContains", "work")).toEqual(["b"]);
  });
  it("listContainsAny / listContainsAll split the value on commas", async () => {
    expect(await keep("listContainsAny", "work, garden")).toEqual(["b"]);
    expect(await keep("listContainsAll", "work, home")).toEqual(["b"]);
    expect(await keep("listContainsAll", "home")).toEqual(["b", "a"]);
  });
  it("listEmpty keeps rows with no tags", async () => {
    expect(await keep("listEmpty", "")).toEqual(["c"]);
  });
  it("membership is case-folded unless Match case is on", async () => {
    expect(await keep("listContains", "HOME")).toEqual(["b", "a"]);
    expect(await keep("listContains", "HOME", true)).toEqual([]);
  });
  it("a scalar cell reads as a one-element list; a blank is empty", async () => {
    const mixed = cubeFromColumns([{ name: "name", cells: ["x", "y", "z"] }, { name: "tags", cells: ["home", null, []] }]);
    const kept = async (op: FilterOp, value: string) => colCells((await filterCube(mixed, [{ column: "tags", op, value }])).kept, "name");
    expect(await kept("listContains", "home")).toEqual(["x"]);
    expect(await kept("listEmpty", "")).toEqual(["y", "z"]);
  });
});

describe("Computed Column over a cube", () => {
  const tasks = () => cubeFromColumns([
    { name: "title", cells: ["A", "B"], type: "string" },
    { name: "timeEstimate", cells: [60, 120], type: "number" },
    { name: "tags", cells: [["work"], ["home", "urgent"]] },
  ]);
  function compute(expr: string, name: string): CubeValue {
    const n = new ComputedColumnNode({ expr });
    n.stringLiterals.name = name;
    return n.data({ frame: [tasks()] as never }).frame as CubeValue;
  }

  it("adds a scalar column computed off the cube's scalar columns; the result is a cube", () => {
    const c = compute("@timeEstimate / 60", "hours");
    expect(isCubeValue(c)).toBe(true);
    expect(colCells(c, "hours")).toEqual([1, 2]);
    expect(c.columns.map((k) => k.name)).toEqual(["title", "timeEstimate", "tags", "hours"]);
  });

  it("a \"Name (unit)\" header splits as on a frame: it replaces the named column, keeps its format and tags the cells", () => {
    const fmt = { format: "number", unit: "" } as never;
    const src = cubeFromColumns([
      { name: "title", cells: ["A", "B"], type: "string" },
      { name: "hours", cells: [1, 2], type: "number", format: fmt },
      { name: "timeEstimate", cells: [60, 120], type: "number" },
    ]);
    const n = new ComputedColumnNode({ expr: "@timeEstimate / 60" });
    n.stringLiterals.name = "hours (kg)";
    const c = n.data({ frame: [src] as never }).frame as CubeValue;
    expect(c.columns.map((k) => k.name)).toEqual(["title", "hours", "timeEstimate"]);
    const hours = c.columns.find((k) => k.name === "hours")!;
    expect(hours.format).toEqual(fmt);
    expect(hours.cells.map((v) => (v as { dim?: unknown }).dim)).toEqual([{ mass: 1 }, { mass: 1 }]);
  });

  it("the list column rides through by reference", () => {
    const src = tasks();
    const n = new ComputedColumnNode({ expr: "@timeEstimate / 60" });
    n.stringLiterals.name = "hours";
    const c = n.data({ frame: [src] as never }).frame as CubeValue;
    expect(colCells(c, "tags")[0]).toEqual(colCells(src, "tags")[0]);
  });

  // [[C22]] rowFormulaRefs
  it("@name reads this row's list, and a list answer is that row's list cell", () => {
    const c = compute("COUNTA(@tags)", "n");
    expect(colCells(c, "n")).toEqual([1, 2]);
    const up = compute("UPPER(@tags)", "up");
    // A one-item answer is one value, as a formula's answer is everywhere.
    expect(colCells(up, "up")).toEqual(["WORK", ["HOME", "URGENT"]]);
    expect(up.columns.find((k) => k.name === "up")!.type).toBe("string");
  });

  // [[C22]] rowFormulaRefs, [[D85]] columnsStayColumns: a column of lists read whole is its rows stacked, padded with blanks.
  it("a bare list column reads as its rows stacked, padded with blanks that totals skip", () => {
    expect(colCells(compute("COUNTA(tags)", "x"), "x")).toEqual([3, 3]);
    expect(colCells(compute("ROWS(tags)", "x"), "x")).toEqual([2, 2]);
    expect(colCells(compute("COLUMNS(tags)", "x"), "x")).toEqual([2, 2]);
    expect(colCells(compute("INDEX(tags, ROW(), 1)", "x"), "x")).toEqual(["work", "home"]);
    const prices = cubeFromColumns([
      { name: "k", cells: ["A", "B"] },
      { name: "prices", cells: [[1, 2, 3], [10]] },
    ]);
    const run = (expr: string) => {
      const n = new ComputedColumnNode({ expr });
      n.stringLiterals.name = "x";
      return colCells(n.data({ frame: [prices] as never }).frame as CubeValue, "x");
    };
    expect(run("SUM(prices)")).toEqual([16, 16]);
    expect(run("SUM(@prices) / SUM(prices)")).toEqual([6 / 16, 10 / 16]);
    expect(run("AVERAGE(prices)")).toEqual([4, 4]);
  });

  it("a list column with a grid in a row has no single table, so read whole it is #SHAPE! pointing at @", () => {
    const grid = cubeFromColumns([{ name: "g", cells: [[[1, 2], [3, 4]], [5]] }]);
    const n = new ComputedColumnNode({ expr: "SUM(g)" });
    n.stringLiterals.name = "x";
    const cells = colCells(n.data({ frame: [grid] as never }).frame as CubeValue, "x");
    expect(cells.every((v) => isSolError(v) && v.code === "#SHAPE!")).toBe(true);
    expect((cells[0] as { message: string }).message).toContain("@g");
  });

  it("a table in one row refuses on that row alone; the column's other rows still compute", () => {
    const mixed = cubeFromColumns([{ name: "tags", cells: [sub0, [1, 2, 3], 5] }]);
    const n = new ComputedColumnNode({ expr: "SUM(@tags)" });
    n.stringLiterals.name = "x";
    const cells = colCells(n.data({ frame: [mixed] as never }).frame as CubeValue, "x");
    expect(isSolError(cells[0]) && (cells[0] as { code: string }).code).toBe("#SHAPE!");
    expect(cells.slice(1)).toEqual([6, 5]);
    const whole = new ComputedColumnNode({ expr: "SUM(tags)" });
    whole.stringLiterals.name = "x";
    const w = colCells(whole.data({ frame: [mixed] as never }).frame as CubeValue, "x");
    expect(w.every((v) => isSolError(v) && v.code === "#SHAPE!")).toBe(true);
  });

  it("a nested table column stays out of formulas", () => {
    const withSub = cubeFromColumns([{ name: "a", cells: [1] }, { name: "sub", cells: [sub0] }]);
    const n = new ComputedColumnNode({ expr: "@sub" });
    n.stringLiterals.name = "x";
    const c = n.data({ frame: [withSub] as never }).frame as CubeValue;
    expect((colCells(c, "x")[0] as { code: string }).code).toBe("#SHAPE!");
  });

  it("SPARKLINE draws each row's own list", () => {
    const series = cubeFromColumns([{ name: "h", cells: [[1, 2, 3], [3, 1]] }]);
    const n = new ComputedColumnNode({ expr: "SPARKLINE(@h)" });
    n.stringLiterals.name = "spark";
    const cells = colCells(n.data({ frame: [series] as never }).frame as CubeValue, "spark");
    expect(cells.every((v) => typeof v === "string" && v.startsWith("data:image/svg+xml,"))).toBe(true);
    expect(cells[0]).not.toBe(cells[1]);
  });
});

describe("Add Column over a cube", () => {
  const tasks = () => cubeFromColumns([
    { name: "title", cells: ["A", "B"], type: "string" },
    { name: "done", cells: [1, 0], type: "number" },
    { name: "tags", cells: [["work"], ["home", "urgent"]] },
  ]);
  function addCol(values: unknown[], name: string): CubeValue {
    const n = new AddColumnNode({ addAs: "number" });
    n.stringLiterals.name = name;
    return n.data({ frame: [tasks()] as never, values: [values as never] }).frame as CubeValue;
  }

  it("appends the new column onto the cube; the result is a cube", () => {
    const c = addCol([10, 20], "score");
    expect(isCubeValue(c)).toBe(true);
    expect(c.columns.map((k) => k.name)).toEqual(["title", "done", "tags", "score"]);
    expect(colCells(c, "score")).toEqual([10, 20]);
  });

  it("a short values list pads with blanks; the nested list column rides through unchanged", () => {
    const src = tasks();
    const n = new AddColumnNode({ addAs: "number" });
    n.stringLiterals.name = "score";
    const c = n.data({ frame: [src] as never, values: [[10] as never] }).frame as CubeValue;
    expect(colCells(c, "score")).toEqual([10, null]);
    expect(colCells(c, "tags")[0]).toEqual(colCells(src, "tags")[0]);
  });
});

describe("the Cube verbs read a column by its declared type", () => {
  const cube = () => cubeFromColumns([
    { name: "id", type: "string", cells: ["010", "9", "2"] },
    { name: "due", type: "date", cells: [46000, 46010, 46020] },
    { name: "tags", cells: [["a"], ["b"], ["c"]] },
  ]);
  it("Window's lag of a date column is a date column, and first of a text ID keeps its text", async () => {
    const lag = await windowCube(cube(), "lag", "due", "prev", 1);
    const prev = lag.columns.find((c) => c.name === "prev")!;
    expect(prev.type).toBe("date");
    expect(prev.cells).toEqual([null, 46000, 46010]);
    const first = await windowCube(cube(), "first", "id", "firstId");
    expect(first.columns.find((c) => c.name === "firstId")!.cells[0]).toBe("010");
  });
  it("Sort orders a declared text column as text", async () => {
    expect(colCells(await sortCube(cube(), "id", "asc"), "id")).toEqual(["010", "2", "9"]);
  });
});
