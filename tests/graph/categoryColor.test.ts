// [[A1]] visualGraphCalculator, [[components#One design system governs every look, layout and word in the app]], [[palette-and-theme#Palette-derived color for charts and chips]]
import { describe, it, expect } from "vitest";
import { categoryColorIndex } from "../../src/graph/categoryColor";


describe("categoryColorIndex — the Chip hue assignment", () => {
  it("assigns a palette index by first appearance, deduped", () => {
    const m = categoryColorIndex(["red", "blue", "red", "green", "blue"]);
    expect(m.get("red")).toBe(0);
    expect(m.get("blue")).toBe(1);
    expect(m.get("green")).toBe(2);
    expect(m.size).toBe(3);
  });

  it("skips null / undefined cells", () => {
    const m = categoryColorIndex([null, "a", undefined, "a", null, "b"]);
    expect(m.get("a")).toBe(0);
    expect(m.get("b")).toBe(1);
    expect(m.size).toBe(2);
  });
});
