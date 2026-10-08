// [[C24]] arraySemantics, [[B17]] typedValueModel
import { describe, it, expect } from "vitest";
import { IFErrorNode } from "../../../src/graph/nodes/logic";
import { solError } from "../../../src/graph/errorValue";
import type { FrameValue, CubeValue } from "../../../src/graph/frame";

const code = (v: unknown) => (v as { code?: string } | null)?.code ?? v;
const div0 = solError("#DIV/0!", "x");

describe("IFERROR reaches into Frame and Cube cells", () => {
  const frame: FrameValue = { __frame: true, columns: [
    { name: "n", type: "number", values: [1, div0, 3] },
    { name: "t", type: "string", values: ["a", solError("#N/A", "x"), "c"] },
  ] };
  it("replaces each caught cell, and a fallback that doesn't suit a column is that cell's #TYPE!", () => {
    const out = new IFErrorNode().data({ value: [frame], fallback: [0] }).result as FrameValue;
    expect(out.columns[0].values).toEqual([1, 0, 3]);
    expect(out.columns[1].values.map(code)).toEqual(["a", "#TYPE!", "c"]);
  });
  it("IFNA catches only #N/A", () => {
    const out = new IFErrorNode({ op: "ifna" }).data({ value: [frame], fallback: ["?"] }).result as FrameValue;
    expect(out.columns[0].values.map(code)).toEqual([1, "#DIV/0!", 3]);
    expect(out.columns[1].values).toEqual(["a", "?", "c"]);
  });
  it("walks a cube's cells, nested ones too", () => {
    const cube: CubeValue = { __cube: true, depth: 1, columns: [{ name: "v", type: "number", cells: [[1, div0], div0] }] };
    const out = new IFErrorNode().data({ value: [cube], fallback: [-1] }).result as CubeValue;
    expect(out.columns[0].cells).toEqual([[1, -1], -1]);
  });
  it("over a Frame the fallback is one value", () => {
    expect(code(new IFErrorNode().data({ value: [frame], fallback: [[1, 2]] }).result)).toBe("#VALUE!");
  });
});
