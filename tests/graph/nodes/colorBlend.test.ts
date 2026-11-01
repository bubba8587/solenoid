// [[C24]]
import { describe, it, expect } from "vitest";
import { ColorBlendNode } from "../../../src/graph/nodes/input";

import { extractInit } from "../../../src/graph/nodeInit";

describe("ColorBlendNode", () => {

  it("multiply by white is identity; screen by black is identity", () => {
    const n = new ColorBlendNode({ mode: "multiply" });
    n.stringLiterals.a = "#ff8040";
    n.stringLiterals.b = "#ffffff";
    expect(n.data({})).toEqual({ color: "#ff8040" });
    n.mode = "screen";
    n.stringLiterals.b = "#000000";
    expect(n.data({})).toEqual({ color: "#ff8040" });
  });

  it("darken/lighten take the per-channel min/max", () => {
    const n = new ColorBlendNode({ mode: "darken" });
    n.stringLiterals.a = "#ff0080";
    n.stringLiterals.b = "#00ff80";
    expect(n.data({})).toEqual({ color: "#000080" });
    n.mode = "lighten";
    expect(n.data({})).toEqual({ color: "#ffff80" });
  });



  it("round-trips mode through extractInit; a stale mode falls back to mix", () => {
    const n = new ColorBlendNode({ mode: "overlay" });
    const init = extractInit(n);
    expect(init.mode).toBe("overlay");
    expect(new ColorBlendNode(init as { mode?: never }).mode).toBe("overlay");
  });
});
