import { describe, it, expect } from "vitest";
import {
  cubeFromColumns, frameFromRows, frameToCube, isCubeValue, selectCubeRows,
  type CubeValue, type FrameValue,
} from "../../src/graph/frame";
import {
  sortCube, distinctCube, sliceCube, filterCube, passesListFilter, encodeCubeCell,
  sortByColumn, distinctRows, sliceRows, filterRowsMulti,
  type FilterCond,
} from "../../src/graph/frameVerbs";
import { isSolError } from "../../src/graph/errorValue";
import { ComputedColumnNode, AddColumnNode } from "../../src/graph/nodes/frame";

// A′: the row verbs take cubes. These pin the frameVerbs cube engine — the cube path
// reorders/keeps WHOLE rows off the flat scalar columns (nested cells ride by reference),
// and the shared index selectors keep the cube order identical to the frame path.

const colCells = (c: CubeValue, name: string) => c.columns.find((k) => k.name === name)!.cells;
const colVals = (f: FrameValue, name: string) => f.columns.find((k) => k.name === name)!.values;
function caught(fn: () => unknown): { code: string } | null {
  try { fn(); return null; } catch (e) { return isSolError(e) ? e : { code: "THREW-NON-ERROR" }; }
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

describe("selectCubeRows", () => {
  it("reorders rows and keeps nested cells identical BY REFERENCE", () => {
    const c = sampleCube();
    const r = selectCubeRows(c, [1, 0]);
    expect(isCubeValue(r)).toBe(true);
    expect(colCells(r, "name")).toEqual(["a", "b"]);
    expect(colCells(r, "priority")).toEqual([1, 2]);
    // The list + sub-table cells are the SAME objects, not copies.
    expect(colCells(r, "tags")[0]).toBe(colCells(c, "tags")[1]);
    expect(colCells(r, "sub")[0]).toBe(sub1);
    expect(colCells(r, "sub")[1]).toBe(sub0);
  });
  it("carries the __cube brand out and blanks an out-of-range index", () => {
    const r = selectCubeRows(sampleCube(), [2, 5]);
    expect(r.__cube).toBe(true);
    expect(colCells(r, "name")).toEqual(["c", null]);
    expect(colCells(r, "tags")[1]).toBeNull();
  });
});

describe("sortCube", () => {
  it("sorts by a scalar column, order identical to the frame path", () => {
    const f = frameFromRows([["b", 2], ["a", 1], ["c", 3]], ["name", "priority"]);
    const fc = frameToCube(f);
    for (const dir of ["asc", "desc"] as const) {
      const sf = sortByColumn(f, "priority", dir);
      const sc = sortCube(fc, "priority", dir);
      expect(colCells(sc, "name")).toEqual(colVals(sf, "name"));
      expect(colCells(sc, "priority")).toEqual(colVals(sf, "priority"));
    }
  });
  it("carries whole rows: sorting by priority reorders the tags list cells too", () => {
    const sc = sortCube(sampleCube(), "priority", "asc");
    expect(colCells(sc, "name")).toEqual(["a", "b", "c"]);
    expect(colCells(sc, "tags")).toEqual([["home"], ["work", "home"], []]);
  });
  it("a list column is not sortable → #SHAPE!", () => {
    expect(caught(() => sortCube(sampleCube(), "tags", "asc"))?.code).toBe("#SHAPE!");
  });
});

describe("distinctCube", () => {
  it("dedupes flat rows identically to the frame path", () => {
    const f = frameFromRows([["a", 1], ["a", 1], ["b", 2], ["a", 1]], ["name", "n"]);
    const fc = frameToCube(f);
    const df = distinctRows(f);
    const dc = distinctCube(fc);
    expect(colCells(dc, "name")).toEqual(colVals(df, "name"));
    expect(colCells(dc, "n")).toEqual(colVals(df, "n"));
  });
  it("keys on list and nested cells structurally", () => {
    const c = cubeFromColumns([
      { name: "tags", cells: [["a", "b"], ["a", "b"], ["a"]] },
      { name: "sub", cells: [sub0, sub0, sub0] },
    ]);
    const d = distinctCube(c);
    // Rows 0 and 1 have equal tags + sub → row 1 drops; row 2 differs.
    expect(colCells(d, "tags")).toEqual([["a", "b"], ["a"]]);
  });
  it("encodeCubeCell keys equal lists equal and different lists apart", () => {
    expect(encodeCubeCell(["a", "b"])).toEqual(encodeCubeCell(["a", "b"]));
    expect(JSON.stringify(encodeCubeCell(["a"]))).not.toBe(JSON.stringify(encodeCubeCell(["a", "b"])));
  });
});

describe("sliceCube", () => {
  it("first / last / skip / range windows match sliceRows", () => {
    const f = frameFromRows([[10], [20], [30], [40], [50]], ["n"]);
    const fc = frameToCube(f);
    const cases: Array<["first" | "last" | "skip" | "range", number, number?]> = [
      ["first", 2], ["last", 2], ["skip", 3], ["range", 2, 4],
    ];
    for (const [mode, n, to] of cases) {
      const sf = sliceRows(f, mode, n, to);
      const sc = sliceCube(fc, mode, n, to);
      expect(colCells(sc, "n")).toEqual(colVals(sf, "n"));
    }
  });
});

describe("filterCube — scalar ops match the frame path", () => {
  const f = frameFromRows([["b", 2], ["a", 1], ["c", 3]], ["name", "priority"]);
  const fc = frameToCube(f);
  it("a numeric condition keeps the same rows", () => {
    const conds: FilterCond[] = [{ column: "priority", op: "gt", value: 1 }];
    const kf = filterRowsMulti(f, "and", conds);
    const kc = filterCube(fc, "and", conds);
    expect(colCells(kc, "name")).toEqual(colVals(kf, "name"));
  });
  it("the complement is the dropped rows", () => {
    const conds: FilterCond[] = [{ column: "priority", op: "gt", value: 1 }];
    const dc = filterCube(fc, "and", conds, true);
    expect(colCells(dc, "name")).toEqual(["a"]);
  });
  it("a scalar op on a list column → #SHAPE!", () => {
    const conds: FilterCond[] = [{ column: "tags", op: "eq", value: "home" }];
    expect(caught(() => filterCube(sampleCube(), "and", conds))?.code).toBe("#SHAPE!");
  });
});

describe("filterCube — list-cell ops (Bases)", () => {
  const c = sampleCube(); // tags: [["work","home"], ["home"], []]
  const keep = (op: FilterCond["op"], value: unknown) =>
    colCells(filterCube(c, "and", [{ column: "tags", op, value: value as never }]), "name");

  it("listContains keeps rows whose tag list holds the value", () => {
    expect(keep("listContains", "home")).toEqual(["b", "a"]);
    expect(keep("listContains", "work")).toEqual(["b"]);
  });
  it("listContainsAny / listContainsAll split the value on commas", () => {
    expect(keep("listContainsAny", "work, garden")).toEqual(["b"]);
    expect(keep("listContainsAll", "work, home")).toEqual(["b"]);
    expect(keep("listContainsAll", "home")).toEqual(["b", "a"]);
  });
  it("listEmpty keeps rows with no tags", () => {
    expect(keep("listEmpty", "")).toEqual(["c"]);
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

  it("the list column rides through by reference", () => {
    const src = tasks();
    const n = new ComputedColumnNode({ expr: "@timeEstimate / 60" });
    n.stringLiterals.name = "hours";
    const c = n.data({ frame: [src] as never }).frame as CubeValue;
    expect(colCells(c, "tags")[0]).toBe(colCells(src, "tags")[0]);
  });

  it("referencing a list column is #SHAPE! per cell (a nested cell is opaque to the formula)", () => {
    const c = compute("@timeEstimate + @tags", "x");
    const cells = colCells(c, "x");
    expect(cells.every((v) => isSolError(v))).toBe(true);
    expect((cells[0] as { code: string }).code).toBe("#SHAPE!");
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

  it("a short values list pads with blanks; the nested list column rides through by reference", () => {
    const src = tasks();
    const n = new AddColumnNode({ addAs: "number" });
    n.stringLiterals.name = "score";
    const c = n.data({ frame: [src] as never, values: [[10] as never] }).frame as CubeValue;
    expect(colCells(c, "score")).toEqual([10, null]);
    expect(colCells(c, "tags")[0]).toBe(colCells(src, "tags")[0]);
  });
});

describe("passesListFilter", () => {
  it("membership is case-folded unless matchCase", () => {
    expect(passesListFilter(["Work", "Home"], "listContains", "home", false)).toBe(true);
    expect(passesListFilter(["Work", "Home"], "listContains", "home", true)).toBe(false);
  });
  it("a scalar cell reads as a one-element list; a blank is empty", () => {
    expect(passesListFilter("home", "listContains", "home", false)).toBe(true);
    expect(passesListFilter(null, "listEmpty", "", false)).toBe(true);
    expect(passesListFilter([], "listEmpty", "", false)).toBe(true);
  });
});
