import { describe, it, expect } from "vitest";
import { ColorBlendNode } from "./input";
import { isSolError } from "../errorValue";
import { extractInit } from "../copyPaste";

describe("ColorBlendNode", () => {
  it("mixes the default pair to their channel average", () => {
    const n = new ColorBlendNode();
    // #56b4e9 + #e69f00 → per-channel average, rounded.
    expect(n.data({})).toEqual({ color: "#9eaa75" });
  });

  it("multiply by white is identity; screen by black is identity", () => {
    const n = new ColorBlendNode({ op: "multiply" });
    n.stringLiterals.a = "#ff8040";
    n.stringLiterals.b = "#ffffff";
    expect(n.data({})).toEqual({ color: "#ff8040" });
    n.op = "screen";
    n.stringLiterals.b = "#000000";
    expect(n.data({})).toEqual({ color: "#ff8040" });
  });

  it("darken/lighten take the per-channel min/max", () => {
    const n = new ColorBlendNode({ op: "darken" });
    n.stringLiterals.a = "#ff0080";
    n.stringLiterals.b = "#00ff80";
    expect(n.data({})).toEqual({ color: "#000080" });
    n.op = "lighten";
    expect(n.data({})).toEqual({ color: "#ffff80" });
  });

  it("wired inputs override the typed literals and accept any CSS color", () => {
    const n = new ColorBlendNode({ op: "mix" });
    expect(n.data({ a: ["rgb(0, 0, 0)"], b: ["white"] })).toEqual({ color: "#808080" });
  });

  it("an unparseable color yields #VALUE! naming the input", () => {
    const n = new ColorBlendNode();
    n.stringLiterals.b = "nonsense";
    const { color } = n.data({});
    expect(isSolError(color)).toBe(true);
    if (isSolError(color)) {
      expect(color.code).toBe("#VALUE!");
      expect(color.message).toContain("Color B");
    }
  });

  it("round-trips mode through extractInit; a stale mode falls back to mix", () => {
    const n = new ColorBlendNode({ op: "overlay" });
    const init = extractInit(n);
    expect(init.op).toBe("overlay");
    expect(new ColorBlendNode(init as { op?: never }).op).toBe("overlay");
    expect(new ColorBlendNode({ op: "gone" as never }).op).toBe("mix");
  });
});
