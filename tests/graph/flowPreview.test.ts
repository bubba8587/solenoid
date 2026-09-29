import { describe, it, expect } from "vitest";
import { previewValue } from "../../src/graph/flow/preview";

describe("previewValue counts rows the way the chips do", () => {
  it("a cube's rows are its longest column", () => {
    const cube = { __cube: true, depth: 1, columns: [{ name: "a", cells: [1] }, { name: "b", cells: [1, 2, 3] }] };
    expect(previewValue(cube)).toBe("3×2×1 Cube");
  });
  it("a frame's rows are its longest column", () => {
    const frame = { __frame: true, columns: [{ name: "a", type: "number", values: [] }, { name: "b", type: "number", values: [1, 2] }] };
    expect(previewValue(frame)).toBe("2×2 Frame");
  });
});
