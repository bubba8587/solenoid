import { describe, it, expect } from "vitest";
import { planColumns, packMasonry } from "../../../src/graph/components/masonryLayout";

const TRACK = { ideal: 170, min: 140, max: 260 };
const GAP = 6;

describe("planColumns", () => {
  it("justifies tracks to fill the container exactly", () => {
    const { count, colWidth } = planColumns(500, GAP, { ...TRACK, items: 10 });
    expect(count).toBe(3);
    expect(count * colWidth + (count - 1) * GAP).toBeCloseTo(500);
  });

  it("compresses toward min before dropping a column, never below it", () => {
    for (let w = 150; w <= 1200; w += 7) {
      const { count, colWidth } = planColumns(w, GAP, { ...TRACK, items: 99 });
      if (count > 1) expect(colWidth).toBeGreaterThanOrEqual(TRACK.min);
    }
  });

  it("caps a track at max so few cards never stretch to a stacked list", () => {
    expect(planColumns(900, GAP, { ...TRACK, items: 1 }).colWidth).toBe(TRACK.max);
    const two = planColumns(900, GAP, { ...TRACK, items: 2 });
    expect(two.count).toBe(2);
    expect(two.colWidth).toBe(TRACK.max);
  });

  it("never plans more tracks than items", () => {
    expect(planColumns(1200, GAP, { ...TRACK, items: 3 }).count).toBe(3);
  });

  it("an unmeasured container falls back to one ideal track", () => {
    expect(planColumns(0, GAP, { ...TRACK, items: 5 })).toEqual({ count: 1, colWidth: TRACK.ideal });
  });
});

describe("packMasonry", () => {
  it("places each item into the shortest column, leftmost on ties", () => {
    // Two columns, gap 6: after [10, 30] the first column (16) is shorter than
    // the second (36), so the next two keep landing there.
    const { slots, height } = packMasonry([10, 30, 10, 10], 2, GAP);
    expect(slots).toEqual([
      { col: 0, y: 0 },
      { col: 1, y: 0 },
      { col: 0, y: 16 },
      { col: 0, y: 32 },
    ]);
    expect(height).toBe(42); // column 0: 10+6+10+6+10
  });

  it("equal heights fill row-major (the uniform-card case)", () => {
    const { slots } = packMasonry([20, 20, 20, 20, 20, 20], 3, GAP);
    expect(slots.map((s) => s.col)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(slots[3].y).toBe(26);
  });

  it("container height is the tallest column without a trailing gap", () => {
    expect(packMasonry([50, 10], 2, GAP).height).toBe(50);
    expect(packMasonry([], 3, GAP).height).toBe(0);
  });
});
