import { describe, it, expect } from "vitest";
import { WindowNode, GroupByFrameNode, ChartNode, AddColumnNode } from "../../src/graph/rete-nodes";
import { wrapNodeData } from "../../src/graph/coerceInputs";
import { cubeFromColumns, flatCubeToFrame, isFrameValue } from "../../src/graph/frame";
import { isSolError } from "../../src/graph/errorValue";
import { canConnect } from "../../src/graph/sockets";
import { collectPreview } from "../../src/graph/frameBackend";

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
  it("cube → frame is still refused at the lattice", () => {
    expect(canConnect("cube", "frame")).toBe(false);
  });

  it("Window, GROUPBY and Chart declare cube-adoptive inputs", () => {
    for (const n of [new WindowNode(), new GroupByFrameNode()]) expect(String((n.inputs.frame!.socket as { base?: string }).base)).toBe("cube");
    expect(String((new ChartNode().inputs.values!.socket as { base?: string }).base)).toBe("cube");
  });

  it("Window over a flat cube runs; over a nested cube it is the loud #SHAPE!", async () => {
    const w = new WindowNode({ agg: "rolling" } as never);
    w.stringLiterals.column = "Steps"; w.stringLiterals.name = "Avg"; w.literals.n = 2;
    const ok = await w.data({ frame: [flat] });
    const out = await collectPreview(ok.frame as never);
    expect(isFrameValue(out) && out.columns.some((c) => c.name === "Avg")).toBe(true);
    const bad = await w.data({ frame: [nested] });
    expect(isSolError(bad.frame) && bad.frame.code).toBe("#SHAPE!");
  });

  it("Chart over a flat cube draws its numeric column", () => {
    const c = new ChartNode();
    const out = c.data({ values: [flat] });
    expect(out.chart.values).toEqual([4000, 6000, 5000]);
    expect(c.data({ values: [nested] }).chart.values).toBeNull();
  });
});

describe("the cube-adoptive input still widens a bare list / matrix (the old frameIn contract)", () => {
  const drive = async (n: object, inputs: Record<string, unknown[]>) => {
    wrapNodeData(n as Parameters<typeof wrapNodeData>[0]);
    return (n as { data: (i: Record<string, unknown[]>) => Promise<{ frame: unknown }> }).data(inputs);
  };
  it("GROUPBY over a wired 2-D table groups it", async () => {
    const g = new GroupByFrameNode();
    g.stringLiterals.column = "Col2";
    const out = await drive(g, { frame: [[["x", 1], ["x", 2]]], keys: [["Col1"]] }); // generated headers, like the old frameIn
    const f = await collectPreview(out.frame as never);
    expect(isFrameValue(f) && f.columns.map((c) => c.values)).toEqual([["x"], [3]]);
  });
  it("Window over a wired list runs on the one-row frame", async () => {
    const w = new WindowNode({ agg: "rolling" } as never);
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
