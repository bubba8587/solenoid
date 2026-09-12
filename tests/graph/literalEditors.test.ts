import { describe, it, expect } from "vitest";
import {
  parseCubeRecords, cubeRecordsToText, getAtPath, setAtPath, recordsShape, parseCellText, cellTextOf,
} from "../../src/graph/literalEditors";
import { CubeInputNode } from "../../src/graph/rete-nodes";
import { extractInit } from "../../src/graph/copyPaste";
import { isCubeValue, type CubeValue } from "../../src/graph/frame";
import { isSolError } from "../../src/graph/errorValue";

// The literal inputs' shared editing helpers + the Cube Input node (the fourth literal
// source beside Table / Frame / List Input).

describe("parseCubeRecords / cubeRecordsToText", () => {
  it("reads a JSON array of records; blank = no rows; anything else is a reasoned error", () => {
    expect(parseCubeRecords('[{"a":1,"t":["x"]}]')).toEqual({ records: [{ a: 1, t: ["x"] }] });
    expect(parseCubeRecords("   ")).toEqual({ records: [] });
    expect("error" in parseCubeRecords("{")).toBe(true);
    expect((parseCubeRecords('{"a":1}') as { error: string }).error).toMatch(/array of records/);
    expect((parseCubeRecords("[1]") as { error: string }).error).toMatch(/row 1/);
    expect(cubeRecordsToText([{ a: 1 }])).toBe('[\n  {\n    "a": 1\n  }\n]');
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
