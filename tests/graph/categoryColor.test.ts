import { describe, it, expect } from "vitest";
import { categoryColorIndex } from "../../src/graph/categoryColor";

// The Chip hue assignment (B2.2): distinct strings → palette index by first appearance.
// Pure and value-keyed, so a value keeps its color anywhere in the column — the property
// that makes chips stable when the display is reordered (the renderer feeds source order).

describe("categoryColorIndex — the Chip hue assignment", () => {
  it("assigns a palette index by first appearance, deduped", () => {
    const m = categoryColorIndex(["red", "blue", "red", "green", "blue"]);
    expect(m.get("red")).toBe(0);
    expect(m.get("blue")).toBe(1);
    expect(m.get("green")).toBe(2);
    expect(m.size).toBe(3);
  });

  it("a value's index is its first-appearance rank regardless of repeats or later position", () => {
    const m = categoryColorIndex(["a", "b", "a", "a", "c", "b"]);
    expect(m.get("a")).toBe(0); // every 'a' resolves to the same slot
    expect(m.get("b")).toBe(1);
    expect(m.get("c")).toBe(2);
  });

  it("is pure — same input, same output", () => {
    const input = ["x", "y", "x", "z"];
    expect([...categoryColorIndex(input)]).toEqual([...categoryColorIndex(input)]);
  });

  it("skips null / undefined cells", () => {
    const m = categoryColorIndex([null, "a", undefined, "a", null, "b"]);
    expect(m.get("a")).toBe(0);
    expect(m.get("b")).toBe(1);
    expect(m.size).toBe(2);
  });

  it("a scalar (one value) is slot 0", () => {
    expect(categoryColorIndex(["solo"]).get("solo")).toBe(0);
  });
});
