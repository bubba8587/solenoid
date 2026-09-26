// [[C86]] membershipByGesture
import { describe, it, expect } from "vitest";
import {
  parseCubeSource, cubeSourceToText, getAtPath, setAtPath, recordsShape, parseCellText, cellTextOf,
} from "../../src/graph/literalEditors";
import { CubeInputNode } from "../../src/graph/rete-nodes";
import { extractInit } from "../../src/graph/copyPaste";
import { isCubeValue, type CubeValue } from "../../src/graph/frame";
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

  // [[D80]] cubeColumnTypes
  it("writes plain records until a column is typed or computed, then { columns, rows }", () => {
    const rows = [{ a: 1 }];
    expect(cubeSourceToText({ columns: [{ name: "a" }], rows })).toBe('[\n  {\n    "a": 1\n  }\n]');
    const typed = { columns: [{ name: "a", type: "number" as const }, { name: "f", expr: "@a*2" }], rows };
    expect(parseCubeSource(cubeSourceToText(typed))).toEqual({ source: typed });
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

// [[D80]] cubeColumnTypes, [[D81]] cubeRowLists
describe("Cube Input typed and formula columns", () => {
  const cube = (source: object) => new CubeInputNode({ cubeText: JSON.stringify(source) }).data().cube as CubeValue;
  const col = (c: CubeValue, name: string) => c.columns.find((x) => x.name === name)!;
  const rows = [{ name: "A", h: [1, "2", 3] }, { name: "B", h: [4, "x"] }];

  it("a typed list column reads every item as List Input would; what it can't read is blank; untyped keeps the items", () => {
    const typed = cube({ columns: [{ name: "name" }, { name: "h", type: "number" }], rows });
    expect(col(typed, "h").cells).toEqual([[1, 2, 3], [4, null]]);
    expect(col(typed, "h").type).toBe("number");
    expect(col(cube({ columns: [{ name: "name" }, { name: "h" }], rows }), "h").cells).toEqual([[1, "2", 3], [4, "x"]]);
  });

  it("a declared type overrides a list's and a nested table's own kinds; the source text is untouched", () => {
    const text = JSON.stringify({ columns: [{ name: "d", type: "date" }], rows: [{ d: ["10-sept-2026", "apple", "banana"] }, { d: "2026-09-01" }, { d: "pear" }, { d: [{ when: "2026-09-02" }] }] });
    const n = new CubeInputNode({ cubeText: text });
    const c = n.data().cube as CubeValue;
    const cells = col(c, "d").cells;
    expect(cells[0]).toEqual([46275, null, null]);
    expect(typeof cells[1]).toBe("number");
    expect(Number.isNaN(cells[2])).toBe(true);
    const nested = cells[3] as CubeValue;
    expect(nested.columns[0].type).toBe("date");
    expect(typeof nested.columns[0].cells[0]).toBe("number");
    expect(n.cubeText).toBe(text);
  });

  it("a formula column reads this row's list and sits where it was declared", () => {
    const c = cube({ columns: [{ name: "name" }, { name: "spark", expr: "SPARKLINE(@h)" }, { name: "h", type: "number" }, { name: "n", expr: "COUNT(@h)" }], rows });
    expect(c.columns.map((x) => x.name)).toEqual(["name", "spark", "h", "n"]);
    expect(col(c, "n").cells).toEqual([3, 1]);
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
