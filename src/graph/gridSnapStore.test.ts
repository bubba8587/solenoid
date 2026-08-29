import { describe, it, expect } from "vitest";
import { snapCoord, DOT_SPACING } from "./gridSnapStore";

// Dots live at world `DOT_SPACING * n` = 24·n (FlowSurface offsets RF's dot pattern onto
// the snapToGrid lattice). snapCoord must always land on one of these.

function isOnDot(v: number): boolean {
  return v % DOT_SPACING === 0;
}

describe("snapCoord", () => {
  it("lands on a dot for a spread of inputs (decimals included)", () => {
    const inputs = [-100, -48, -24, -1, -0.5, 0, 1, 11, 12.7, 13, 23, 24, 25, 35.1, 47, 48, 100, 1000];
    for (const v of inputs) {
      expect(isOnDot(snapCoord(v)), `snapCoord(${v}) should land on a dot`).toBe(true);
    }
  });

  it("snaps 12 (midway between dots) up to 24 — regression guard", () => {
    expect(snapCoord(12)).toBe(24);
  });

  it("nearest-dot: output is within half a grid step of input", () => {
    const inputs = [-50, -25, -13, -1, 0, 1, 12, 13, 24, 25, 36, 50, 99, 1001];
    const halfStep = DOT_SPACING / 2;
    for (const v of inputs) {
      expect(Math.abs(snapCoord(v) - v)).toBeLessThanOrEqual(halfStep);
    }
  });

  it("is idempotent: snapping an already-snapped value is a no-op", () => {
    const inputs = [-25, 0, 1, 24, 37, 100];
    for (const v of inputs) {
      const once = snapCoord(v);
      expect(snapCoord(once)).toBe(once);
    }
  });

  it("works for negative values and never returns -0", () => {
    expect(snapCoord(-24)).toBe(-24);
    expect(snapCoord(-11)).toBe(0);
    expect(Object.is(snapCoord(-11), -0)).toBe(false);
    expect(snapCoord(-36)).toBe(-24); // tie goes toward +∞
    expect(snapCoord(-47)).toBe(-48);
  });
});
