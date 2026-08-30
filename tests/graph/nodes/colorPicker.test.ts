import { describe, it, expect } from "vitest";
import { ColorPickerNode } from "../../../src/graph/nodes/input";
import { extractInit } from "../../../src/graph/copyPaste";

describe("ColorPickerNode", () => {
  it("defaults to #56b4e9 and formats per the chosen format", () => {
    const n = new ColorPickerNode();
    expect(n.data()).toEqual({ color: "#56b4e9" });
    n.format = "rgb";
    expect(n.data()).toEqual({ color: "rgb(86, 180, 233)" });
  });

  it("reads channels as HSV in hsv mode", () => {
    const n = new ColorPickerNode({ mode: "hsv", c0: 0, c1: 100, c2: 100 });
    expect(n.data()).toEqual({ color: "#ff0000" }); // pure red
  });

  it("reads a typed hex in hex mode and reformats it", () => {
    const n = new ColorPickerNode({ mode: "hex", format: "rgb" });
    n.stringLiterals.hex = "#ff8000";
    expect(n.data()).toEqual({ color: "rgb(255, 128, 0)" });
    // invalid hex falls back to black rather than throwing
    n.stringLiterals.hex = "nonsense";
    n.format = "hex";
    expect(n.data()).toEqual({ color: "#000000" });
  });

  it("round-trips mode, format and channels through extractInit", () => {
    const n = new ColorPickerNode({ mode: "hsv", format: "rgb", c0: 120, c1: 100, c2: 100 });
    const init = extractInit(n);
    expect(init.mode).toBe("hsv");
    expect(init.format).toBe("rgb");
    expect(init.c0).toBe(120);
    const n2 = new ColorPickerNode(init);
    expect(n2.data()).toEqual({ color: "rgb(0, 255, 0)" }); // pure green
  });
});
