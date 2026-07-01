import { describe, it, expect } from "vitest";
import { packNodeInstances, FLOATS_PER_INSTANCE, type NodeCard } from "./nodeInstances";

const card = (over: Partial<NodeCard> = {}): NodeCard => ({
  x: 10, y: 20, w: 120, h: 60,
  body: { r: 0, g: 0, b: 0, a: 1 },
  header: { r: 255, g: 255, b: 255, a: 1 },
  radius: 6, headerH: 24,
  ...over,
});

describe("packNodeInstances", () => {
  it("emits FLOATS_PER_INSTANCE floats per card", () => {
    const arr = packNodeInstances([card(), card(), card()]);
    expect(arr.length).toBe(3 * FLOATS_PER_INSTANCE);
  });

  it("lays out rect, colours, radius, headerH in order", () => {
    const arr = packNodeInstances([card({
      x: 1, y: 2, w: 3, h: 4,
      body: { r: 255, g: 0, b: 0, a: 1 },
      header: { r: 0, g: 0, b: 255, a: 1 },
      radius: 5, headerH: 7,
    })]);
    expect([...arr]).toEqual([
      1, 2, 3, 4,        // rect
      1, 0, 0, 1,        // body red (premult α=1)
      0, 0, 1, 1,        // header blue
      5, 7,              // radius, headerH
    ]);
  });

  it("premultiplies colour by alpha", () => {
    const arr = packNodeInstances([card({
      body: { r: 200, g: 100, b: 50, a: 0.5 },
      header: { r: 255, g: 255, b: 255, a: 0 },
    })]);
    // body: (200/255)*0.5 ≈ 0.392, alpha 0.5
    expect(arr[4]).toBeCloseTo((200 / 255) * 0.5, 6);
    expect(arr[7]).toBeCloseTo(0.5, 6);
    // header alpha 0 → all zero
    expect(arr[8]).toBe(0); expect(arr[11]).toBe(0);
  });

  it("empty list → empty array", () => {
    expect(packNodeInstances([]).length).toBe(0);
  });
});
