import { describe, it, expect } from "vitest";
import { WriteFileNode } from "../../../src/graph/rete-nodes";

const dt = (n: WriteFileNode) => (n.inputs.in?.socket as unknown as { dataType: string }).dataType;

describe("WriteFileNode — the Text target and its input socket", () => {
  it("csv/json take a frame input; text takes a string input", () => {
    expect(dt(new WriteFileNode())).toBe("frame");
    expect(dt(new WriteFileNode({ format: "json" }))).toBe("frame");
    expect(dt(new WriteFileNode({ format: "text" }))).toBe("string");
  });

  it("setFormat retypes the input only across the text boundary", () => {
    const n = new WriteFileNode();
    expect(n.setFormat("json")).toBe(false); // csv → json: both frames, no retype
    expect(dt(n)).toBe("frame");
    expect(n.setFormat("text")).toBe(true); // frame → string
    expect(dt(n)).toBe("string");
    expect(n.format).toBe("text");
    expect(n.setFormat("csv")).toBe(true); // string → frame
    expect(dt(n)).toBe("frame");
    expect(n.setFormat("csv")).toBe(false); // no-op
  });

  it("text mode caches a wired string and never errors in data() (the write is Run-only)", () => {
    const n = new WriteFileNode({ format: "text" });
    expect(n.data({ in: ["<Project/>"] })).toEqual({});
    expect(n.cachedFrame).toBeNull(); // a string is not a frame/error, so no preview or error cached
  });
});
