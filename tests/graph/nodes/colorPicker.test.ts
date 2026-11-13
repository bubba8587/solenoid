// [[A1]] visualGraphCalculator, [[group-expand-push#Who is a member]]
import { describe, it, expect } from "vitest";
import { ColorPickerNode } from "../../../src/graph/nodes/input";
import { pasteCopy } from "../fixtures/pasteCopy";

describe("ColorPickerNode", () => {



  it("round-trips mode, format and channels through the paste path", async () => {
    const n = new ColorPickerNode({ mode: "hsv", format: "rgb", c0: 120, c1: 100, c2: 100 });
    const n2 = await pasteCopy(n);
    expect(n2.data()).toEqual({ color: "rgb(0, 255, 0)" }); // pure green
  });
});
