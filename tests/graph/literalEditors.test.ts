// [[C86]] membershipByGesture
import { describe, it, expect } from "vitest";
import {
  parseCubeSource, cubeSourceToText, getAtPath, setAtPath, recordsShape, parseCellText, cellTextOf,
  cellKindOf, convertCellKind,
} from "../../src/graph/literalEditors";
import { CubeInputNode } from "../../src/graph/rete-nodes";
import { extractInit } from "../../src/graph/copyPaste";
import { isCubeValue, isFrameValue, type CubeValue, type FrameValue } from "../../src/graph/frame";
import { isSolError } from "../../src/graph/errorValue";

// The literal inputs' shared editing helpers + the Cube Input node (the fourth literal
// source beside Table / Frame / List Input).

describe("parseCubeSource / cubeSourceToText", () => {
  it("reads a JSON array of records; blank = no rows; anything else is a reasoned error", () => {
    expect(parseCubeSource('[{"a":1,"t":["x"]}]')).toEqual({ source: { columns: [{ name: "a" }, { name: "t" }], rows: [{ a: 1, t: ["x"] }] } });
    expect(parseCubeSource("   ")).toEqual({ source: { columns: [], rows: [] } });
    expect("error" in parseCubeSource("{")).toBe(true);
    expect((parseCubeSource('{"a":1}') as { error: string }).error).toMatch(/array of records/);
    expect((parseCubeSource("[1]") as { error: string }).error).toMatch(/row 1/);
  });

  // [[D90]] cubeTypesAtDepth
  it("writes plain records until a column is typed or computed, then { columns, rows }", () => {
    const rows = [{ a: 1 }];
    expect(cubeSourceToText({ columns: [{ name: "a" }], rows })).toBe('[\n  {\n    "a": 1\n  }\n]');
    const typed = { columns: [{ name: "a", type: "number" as const }, { name: "f", expr: "@a*2" }], rows };
    expect(parseCubeSource(cubeSourceToText(typed))).toEqual({ source: typed });
  });

  // [[D90]] cubeTypesAtDepth
  it("a nested table's types ride under its records path and round-trip; a bad key or pick is dropped", () => {
    const typed = { columns: [{ name: "tasks" }], rows: [{ tasks: [{ hours: 1 }] }], nested: { '[0,"tasks"]': { frame: true as const, types: { hours: "number" as const } } } };
    expect(parseCubeSource(cubeSourceToText(typed))).toEqual({ source: typed });
    const bad = JSON.stringify({ columns: [{ name: "t" }], rows: [], nested: { nope: { types: { a: "number" } }, '[0,"t"]': { types: { a: "frame" }, frame: "yes" } } });
    expect((parseCubeSource(bad) as { source: unknown }).source).toEqual({ columns: [{ name: "t" }], rows: [] });
  });

  it("declared columns keep their order; undeclared record keys follow; a bad type is none", () => {
    const text = JSON.stringify({ columns: [{ name: "b", type: "nope" }, { name: "f", expr: "" }], rows: [{ a: 1, b: 2 }] });
    expect((parseCubeSource(text) as { source: unknown }).source).toEqual({
      columns: [{ name: "b" }, { name: "f", expr: "" }, { name: "a" }], rows: [{ a: 1, b: 2 }],
    });
  });
});

describe("paths + shapes + cell text", () => {
  const recs = [{ task: "A", after: [], sub: [{ k: 1 }, { k: 2 }] }, { task: "B", after: ["A"] }];
  it("getAtPath / setAtPath address [row, key, row, key…] and copy on write", () => {
    expect(getAtPath(recs, [1, "after"])).toEqual(["A"]);
    expect(getAtPath(recs, [0, "sub", 1, "k"])).toBe(2);
    const next = setAtPath(recs, [0, "sub", 1, "k"], 9);
    expect(getAtPath(next, [0, "sub", 1, "k"])).toBe(9);
    expect(getAtPath(recs, [0, "sub", 1, "k"])).toBe(2); // untouched
    expect(setAtPath(recs, [2, "task"], "C")[2]).toEqual({ task: "C" }); // a new row appears
  });
  it("recordsShape sorts a cell into the editor that owns it", () => {
    expect(recordsShape(["a"])).toBe("list");
    expect(recordsShape([])).toBe("empty");
    expect(recordsShape([{ k: 1 }])).toBe("frame");
    expect(recordsShape([{ k: [1] }])).toBe("cube");
    expect(recordsShape("x")).toBe("scalar");
    expect(recordsShape(null)).toBe("scalar");
  });
  // [[D90]] cubeTypesAtDepth
  it("a cell switches between a value, a list, a table, a Frame and a Cube, keeping what it can", () => {
    expect([cellKindOf(3), cellKindOf(null), cellKindOf([]), cellKindOf([1]), cellKindOf([[1, 2], [3]]), cellKindOf([{ a: 1 }]), cellKindOf([{ a: 1 }], true), cellKindOf({ a: 1 })])
      .toEqual(["value", "value", "list", "list", "table", "cube", "frame", "cube"]);
    expect(convertCellKind(3, "value", "list")).toEqual([3]);
    expect(convertCellKind(null, "value", "list")).toEqual([]);
    expect(convertCellKind(3, "value", "table")).toEqual([[3]]);
    expect(convertCellKind([1, 2], "list", "table")).toEqual([[1, 2]]);
    expect(convertCellKind([[1, 2], [3, 4]], "table", "list")).toEqual([1, 2]);
    expect(convertCellKind(3, "value", "frame")).toEqual([{ "Column 1": 3 }]);
    expect(convertCellKind(null, "value", "cube")).toEqual([{ "Column 1": null }]);
    expect(convertCellKind([1, "b"], "list", "cube")).toEqual([{ "Column 1": 1 }, { "Column 1": "b" }]);
    expect(convertCellKind([], "list", "frame")).toEqual([{ "Column 1": null }]);
    expect(convertCellKind([{ a: 1, b: 2 }, { a: 3 }], "cube", "list")).toEqual([1, 3]);
    expect(convertCellKind([{ a: 1, b: 2 }, { a: 3 }], "frame", "table")).toEqual([[1, 2], [3, null]]);
    expect(convertCellKind([[1, 2], [3, 4]], "table", "frame")).toEqual([{ "Column 1": 1, "Column 2": 2 }, { "Column 1": 3, "Column 2": 4 }]);
    expect(convertCellKind([{ a: 1, t: [1, 2] }], "cube", "frame")).toEqual([{ a: 1, t: null }]);
    expect(convertCellKind([{ a: 1 }], "frame", "cube")).toEqual([{ a: 1 }]);
    expect(convertCellKind([7, 8], "list", "value")).toBe(7);
    expect(convertCellKind([[5]], "table", "value")).toBe(5);
    expect(convertCellKind([{ a: "x" }], "cube", "value")).toBe("x");
    expect(convertCellKind("same", "value", "value")).toBe("same");
  });

  it("parseCellText / cellTextOf round-trip scalars; lists show as JSON", () => {
    expect(parseCellText("3.5")).toBe(3.5);
    expect(parseCellText("TRUE")).toBe(true);
    expect(parseCellText("")).toBeNull();
    expect(parseCellText("hello")).toBe("hello");
    expect(cellTextOf(["a", 1])).toBe('["a",1]');
    expect(cellTextOf(null)).toBe("");
  });
});

describe("CubeInputNode", () => {
  it("derives a cube from its text; list values are list cells; cubeText round-trips", () => {
    const n = new CubeInputNode({ cubeText: '[{"task":"A","after":[]},{"task":"B","after":["A"]}]' });
    const out = n.data();
    expect(isCubeValue(out.cube)).toBe(true);
    const c = out.cube as CubeValue;
    expect(c.columns.map((x) => x.name)).toEqual(["task", "after"]);
    expect(c.columns[1].cells).toEqual([[], ["A"]]);
    expect(extractInit(n as never).cubeText).toBe(n.cubeText);
  });
  it("bad text is one #VALUE! with the reason; a fresh node carries the starter text", () => {
    const n = new CubeInputNode({ cubeText: "[1, 2" });
    const out = n.data();
    expect(isSolError(out.cube) && out.cube.code).toBe("#VALUE!");
    expect(isCubeValue(new CubeInputNode().data().cube)).toBe(true);
  });
});

// [[D90]] cubeTypesAtDepth, [[C22]] rowFormulaRefs
describe("Cube Input typed and formula columns", () => {
  const cube = (source: object) => new CubeInputNode({ cubeText: JSON.stringify(source) }).data().cube as CubeValue;
  const col = (c: CubeValue, name: string) => c.columns.find((x) => x.name === name)!;
  const rows = [{ name: "A", h: [1, "2", 3] }, { name: "B", h: [4, "x"] }];

  it("a typed list column reads every item as a Frame cell would; what it can't read is NaN; untyped keeps the items", () => {
    const typed = cube({ columns: [{ name: "name" }, { name: "h", type: "number" }], rows });
    expect(col(typed, "h").cells).toEqual([[1, 2, 3], [4, NaN]]);
    expect(col(typed, "h").type).toBe("number");
    expect(col(cube({ columns: [{ name: "name" }, { name: "h" }], rows }), "h").cells).toEqual([[1, "2", 3], [4, "x"]]);
  });

  it("a declared type overrides a list's items but never a nested table's; the source text is untouched", () => {
    const text = JSON.stringify({ columns: [{ name: "d", type: "date" }], rows: [{ d: ["10-sept-2026", "apple", "banana"] }, { d: "2026-09-01" }, { d: "pear" }, { d: [{ when: "2026-09-02", n: 4 }] }] });
    const n = new CubeInputNode({ cubeText: text });
    const c = n.data().cube as CubeValue;
    const cells = col(c, "d").cells;
    expect(cells[0]).toEqual([46275, NaN, NaN]);
    expect(typeof cells[1]).toBe("number");
    expect(Number.isNaN(cells[2])).toBe(true);
    const nested = cells[3] as CubeValue;
    expect(nested.columns.map((x) => x.cells[0])).toEqual(["2026-09-02", 4]);
    expect(nested.columns[1].type).toBe("number");
    expect(n.cubeText).toBe(text);
  });

  it("each nested table types its own columns, per cell and at any depth, beside its column's own type", () => {
    const c = cube({
      columns: [{ name: "tasks", type: "number" }],
      rows: [
        { tasks: [{ hours: "3", note: 12, steps: [{ due: "2026-09-02", x: "5" }] }] },
        { tasks: [{ hours: "x", note: "ok" }] },
        { tasks: ["4", "y"] },
        { tasks: [["1", "z"]] },
      ],
      nested: { '[0,"tasks"]': { types: { hours: "number", note: "string" } }, '[0,"tasks",0,"steps"]': { types: { due: "date" } }, '[1,"tasks"]': { types: { note: "number" } } },
    });
    const cells = col(c, "tasks").cells;
    const t0 = cells[0] as CubeValue;
    expect(t0.columns.find((x) => x.name === "hours")!.cells).toEqual([3]);
    expect(t0.columns.find((x) => x.name === "note")!.cells).toEqual(["12"]);
    const steps = t0.columns.find((x) => x.name === "steps")!.cells[0] as CubeValue;
    expect(steps.columns[0].type).toBe("date");
    expect(steps.columns[0].cells[0]).toBe(46267);
    expect(steps.columns[1].cells[0]).toBe("5");
    const t1 = cells[1] as CubeValue;
    expect(t1.columns[0].cells[0]).toBe("x");
    expect(Number.isNaN(t1.columns[1].cells[0])).toBe(true);
    expect(cells[2]).toEqual([4, NaN]);
    expect(cells[3]).toEqual([[1, NaN]]);
  });

  it("a cell declared a Frame is a flat, typed Frame; the same records undeclared are a Cube", () => {
    const c = cube({
      columns: [{ name: "t" }],
      rows: [{ t: [{ a: "1", b: [2] }] }, { t: [{ a: "1" }] }],
      nested: { '[0,"t"]': { frame: true, types: { a: "number" } } },
    });
    const [f, k] = col(c, "t").cells;
    expect(isFrameValue(f)).toBe(true);
    expect((f as FrameValue).columns.map((x) => [x.name, x.type, x.values[0]])).toEqual([["a", "number", 1], ["b", "string", null]]);
    expect(isCubeValue(k)).toBe(true);
  });

  it("a formula column reads this row's list and sits where it was declared", () => {
    const c = cube({ columns: [{ name: "name" }, { name: "spark", expr: "SPARKLINE(@h)" }, { name: "h", type: "number" }, { name: "n", expr: "COUNT(@h)" }], rows });
    expect(c.columns.map((x) => x.name)).toEqual(["name", "spark", "h", "n"]);
    expect(col(c, "n").cells).toEqual([3, 2]);
    expect(col(c, "spark").cells.every((v) => typeof v === "string" && v.startsWith("data:image/svg+xml,"))).toBe(true);
  });

  it("formula columns fill in dependency order; a cycle, a bad parse and a missing name are errors", () => {
    const c = cube({ columns: [{ name: "b", expr: "@a + 1" }, { name: "a", expr: "LEN(@name)" }, { name: "x", expr: "@y" }, { name: "y", expr: "@x" }, { name: "p", expr: "1 +" }, { name: "q", expr: "@nope" }, { name: "e", expr: "" }], rows });
    expect(col(c, "b").cells).toEqual([2, 2]);
    expect((col(c, "x").cells[0] as { message: string }).message).toMatch(/Circular/);
    expect((col(c, "p").cells[0] as { code: string }).code).toBe("#VALUE!");
    expect((col(c, "q").cells[0] as { code: string }).code).toBe("#REF!");
    expect(col(c, "e").cells).toEqual([null, null]);
  });

  it("an unchanged text returns the same cube", () => {
    const n = new CubeInputNode({ cubeText: JSON.stringify({ columns: [{ name: "n", expr: "1" }], rows: [{}] }) });
    expect(n.data().cube).toBe(n.data().cube);
  });
});
