import { describe, it, expect } from "vitest";
import { miterOffsets, tessellatePolyline, tessellateCablePath } from "./cableTessellate";

describe("miterOffsets", () => {
  it("straight horizontal line → vertical offsets of half-width", () => {
    const o = miterOffsets([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 1);
    for (const off of o) {
      expect(Math.abs(off.x)).toBeCloseTo(0, 9);
      expect(Math.abs(off.y)).toBeCloseTo(1, 9);
    }
  });

  it("a 90° corner miters outward by 1/cos(45°)=√2 (within the cap)", () => {
    // L-shape: right then up. Interior vertex offset grows by √2.
    const o = miterOffsets([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 1);
    const mid = o[1];
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(Math.SQRT2, 6);
  });

  it("caps the miter at miterLimit on a sharp fold", () => {
    // Near-180° reversal would send the miter to infinity; must cap.
    const o = miterOffsets([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0.0001 }], 1, 4);
    expect(Math.hypot(o[1].x, o[1].y)).toBeLessThanOrEqual(4 + 1e-6);
  });

  it("single / empty point lists don't throw", () => {
    expect(miterOffsets([], 1)).toEqual([]);
    expect(miterOffsets([{ x: 5, y: 5 }], 1)).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("tessellatePolyline", () => {
  it("emits 6 vertices (12 floats) per segment", () => {
    const sink: number[] = [];
    const n = tessellatePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 2, sink);
    expect(n).toBe(12);            // 2 segments × 6
    expect(sink.length).toBe(24);  // × (x,y)
  });

  it("a width-2 horizontal segment spans y∈[-1,1] at the right x", () => {
    const sink: number[] = [];
    tessellatePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2, sink);
    const ys = sink.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeCloseTo(1, 9);
    expect(Math.min(...ys)).toBeCloseTo(-1, 9);
    const xs = sink.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(10, 9);
  });

  it("<2 points → nothing", () => {
    const sink: number[] = [];
    expect(tessellatePolyline([{ x: 1, y: 1 }], 2, sink)).toBe(0);
    expect(sink.length).toBe(0);
  });
});

describe("tessellateCablePath", () => {
  it("flattens + tessellates an SVG cable d (curve → many segments)", () => {
    const sink: number[] = [];
    const n = tessellateCablePath("M 0,0 C 0,20 100,20 100,0", 2, sink);
    expect(n).toBeGreaterThan(12);     // a flattened cubic = many segments
    expect(n % 6).toBe(0);             // whole triangles
    expect(sink.length).toBe(n * 2);
  });

  it("respects a straight L cable", () => {
    const sink: number[] = [];
    const n = tessellateCablePath("M 0,0 L 50,0", 4, sink);
    expect(n).toBe(6);
  });
});
