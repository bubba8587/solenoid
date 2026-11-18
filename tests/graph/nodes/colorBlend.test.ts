// [[C24]]
import { describe, it, expect } from "vitest";
import { ColorBlendNode } from "../../../src/graph/nodes/input";
import { extractInit } from "../../../src/graph/nodeInit";

describe("ColorBlendNode", () => {
  it("round-trips mode through extractInit; a stale mode falls back to mix", () => {
    const n = new ColorBlendNode({ mode: "overlay" });
    const init = extractInit(n);
    expect(init.mode).toBe("overlay");
    expect(new ColorBlendNode(init as { mode?: never }).mode).toBe("overlay");
  });
});
