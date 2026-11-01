// [[C10]]
import { describe, it, expect } from "vitest";
import { WindowNode, GroupByFrameNode, ChartNode, AddColumnNode, ColumnsNode } from "../../src/graph/nodeClasses";
import { throughBoundary } from "./boundaryKit";
import { cubeFromColumns, flatCubeToFrame, isFrameValue } from "../../src/graph/frame";
import { isSolError } from "../../src/graph/errorValue";
import { collectPreview } from "../../src/graph/frameBackend";
import type { ChartValue } from "../../src/graph/chartValue";
const draw = (n: ChartNode, inputs: Parameters<ChartNode["data"]>[0]) => n.data(inputs) as { chart: ChartValue };

// The author's ruling (2026-09-12): a cube never enters a frame socket through the lattice;
// a verb that wants one gets a cube-adoptive INPUT and flattens inside data().

const flat = cubeFromColumns([
  { name: "Day", cells: ["Mon", "Tue", "Wed"], type: "string" },
  { name: "Steps", cells: [4000, 6000, 5000], type: "number" },
]);
const nested = cubeFromColumns([
  { name: "Day", cells: ["Mon"], type: "string" },
  { name: "Tags", cells: [["a", "b"]] },
]);

describe("flatCubeToFrame", () => {
  it("a flat cube becomes a frame with its declared types; a nested cell is a #SHAPE! naming the column", () => {
    const f = flatCubeToFrame(flat);
    expect(isFrameValue(f) && f.columns.map((c) => [c.name, c.type])).toEqual([["Day", "string"], ["Steps", "number"]]);
    const e = flatCubeToFrame(nested);
    expect(isSolError(e) && e.code).toBe("#SHAPE!");
    expect(isSolError(e) && e.message).toMatch(/"Tags"/);
  });
});

describe("the lattice stays narrow; the nodes widen", () => {
  it("Window, GROUPBY and Chart declare cube-adoptive inputs", () => {
    for (const n of [new WindowNode(), new GroupByFrameNode(), new ColumnsNode()]) expect(String((n.inputs.frame!.socket as { base?: string }).base)).toBe("cube");
    expect(String((new ChartNode().inputs.values!.socket as { base?: string }).base)).toBe("cube");
  });



  it("Chart over a flat cube draws its numeric column", () => {
    const c = new ChartNode();
    const out = draw(c, { values: [flat] });
    expect(out.chart.values).toEqual([4000, 6000, 5000]);
    // A list column has nothing to plot; the chart draws the rest.
    const withTags = cubeFromColumns([...flat.columns, { name: "Tags", cells: [["a"], [], ["b"]] }]);
    expect(draw(c, { values: [withTags] }).chart.values).toEqual([4000, 6000, 5000]);
  });
});

describe("the cube-adoptive input still widens a bare list / matrix (the old frameIn contract)", () => {
  const drive = async (n: object, inputs: Record<string, unknown[]>) => {
    throughBoundary(n as Parameters<typeof throughBoundary>[0]);
    return (n as { data: (i: Record<string, unknown[]>) => Promise<{ frame: unknown }> }).data(inputs);
  };
  it("GROUPBY over a cube reads only its key and value columns, list columns elsewhere included", async () => {
    const g = new GroupByFrameNode();
    g.stringLiterals.column = "Steps";
    const cube = cubeFromColumns([
      { name: "Day", cells: ["Mon", "Mon", "Tue"], type: "string" },
      { name: "Steps", cells: [1, 2, 3], type: "number" },
      { name: "Tags", cells: [["a"], [], ["b"]] },
    ]);
    const out = await g.data({ frame: [cube], keys: [["Day"]] });
    const f = await collectPreview(out.frame as never);
    expect(isFrameValue(f) && f.columns.map((c) => c.values)).toEqual([["Mon", "Tue"], [3, 3]]);
    g.stringLiterals.column = "Tags";
    const bad = await g.data({ frame: [cube], keys: [["Day"]] });
    expect(isSolError(bad.frame) && bad.frame.code).toBe("#SHAPE!");
  });
  it("GROUPBY over a wired 2-D table groups it", async () => {
    const g = new GroupByFrameNode();
    g.stringLiterals.column = "Col2";
    const out = await drive(g, { frame: [[["x", 1], ["x", 2]]], keys: [["Col1"]] }); // generated headers, like the old frameIn
    const f = await collectPreview(out.frame as never);
    expect(isFrameValue(f) && f.columns.map((c) => c.values)).toEqual([["x"], [3]]);
  });
  it("Window over a wired list runs on the one-row frame", async () => {
    const w = new WindowNode({ agg: "rolling_avg" });
    w.stringLiterals.column = "Col1"; w.stringLiterals.name = "Avg"; w.literals.n = 1;
    const out = await drive(w, { frame: [[1, 2, 3]] });
    const f = await collectPreview(out.frame as never);
    expect(isFrameValue(f) && f.columns.some((c) => c.name === "Avg")).toBe(true);
  });
  it("Add Column over a wired list appends onto the one-row frame", async () => {
    const a = new AddColumnNode({ addAs: "number" });
    a.stringLiterals.name = "X";
    const out = await drive(a, { frame: [[1, 2, 3]], values: [[9]] });
    expect(isFrameValue(out.frame) && out.frame.columns.map((c) => c.name)).toEqual(["Col1", "Col2", "Col3", "X"]);
  });
  it("flatCubeToFrame keeps a column's display format", () => {
    const c = cubeFromColumns([{ name: "When", cells: [46000], type: "date", format: { format: "datetime", unit: "none" } as never }]);
    const f = flatCubeToFrame(c);
    expect(isFrameValue(f) && f.columns[0].format?.format).toBe("datetime");
  });
});

