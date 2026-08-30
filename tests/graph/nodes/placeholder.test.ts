import { describe, it, expect } from "vitest";
import { PlaceholderNode } from "../../../src/graph/nodes/placeholder";
import { isSolError } from "../../../src/graph/errorValue";

describe("PlaceholderNode", () => {
  it("synthesizes the input + output sockets it's told to", () => {
    const n = new PlaceholderNode({
      missingType: "SomePackNode",
      inputKeys: ["x", "y"],
      outputKeys: ["out"],
    });
    expect(Object.keys(n.inputs)).toEqual(["x", "y"]);
    expect(Object.keys(n.outputs)).toEqual(["out"]);
  });

  it("keeps the original type, init, and literals for a lossless re-save", () => {
    const n = new PlaceholderNode({
      missingType: "SomePackNode",
      savedInit: { op: "add", label: "Mine" },
      savedLiterals: { a: 3 },
      savedStringLiterals: { s: "hi" },
    });
    expect(n.missingType).toBe("SomePackNode");
    expect(n.savedInit).toEqual({ op: "add", label: "Mine" });
    expect(n.savedLiterals).toEqual({ a: 3 });
    expect(n.savedStringLiterals).toEqual({ s: "hi" });
  });

  it("defaults its label to the missing type when none is given", () => {
    expect(new PlaceholderNode({ missingType: "Foo" }).label).toBe("Foo");
    expect(new PlaceholderNode({ missingType: "Foo", label: "Bar" }).label).toBe("Bar");
  });

  it("emits a #REF! error on every output (the break is loud, not silent)", () => {
    const n = new PlaceholderNode({ missingType: "Foo", outputKeys: ["a", "b"] });
    const out = n.data();
    for (const k of ["a", "b"]) {
      expect(isSolError(out[k])).toBe(true);
      expect((out[k] as { code: string }).code).toBe("#REF!");
    }
  });

  it("emits nothing when it has no outputs", () => {
    const n = new PlaceholderNode({ missingType: "Foo" });
    expect(n.data()).toEqual({});
  });
});
