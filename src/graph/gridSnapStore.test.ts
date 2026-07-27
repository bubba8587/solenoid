import { describe, it, expect } from "vitest";
import { snapCoord, DOT_SPACING } from "./gridSnapStore";

// Dots live at world `DOT_PHASE + DOT_SPACING * n` = 12 + 24·n.
// snapCoord must always land on one of these.

function isOnDot(v: number): boolean {
  return (v - 12) % 24 === 0;
}

describe("snapCoord", () => {
  it("already-on-dot values are unchanged", () => {
    expect(snapCoord(12)).toBe(12);
    expect(snapCoord(36)).toBe(36);
    expect(snapCoord(60)).toBe(60);
    expect(snapCoord(-12)).toBe(-12);
    expect(snapCoord(-36)).toBe(-36);
  });

  it("lands on a dot for a spread of inputs", () => {
    const inputs = [-100, -48, -24, -1, 0, 1, 11, 13, 23, 24, 25, 47, 48, 100, 1000];
    for (const v of inputs) {
      expect(isOnDot(snapCoord(v)), `snapCoord(${v}) should land on a dot`).toBe(true);
    }
  });

  it("snaps 24 (a square center between dots) to 36, not 24 — regression guard", () => {
    // 24 is midway between dots 12 and 36; tie goes up, so must be 36.
    expect(snapCoord(24)).toBe(36);
    expect(snapCoord(24)).not.toBe(24);
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

  it("works for negative values", () => {
    expect(snapCoord(-12)).toBe(-12);
    expect(snapCoord(-24)).toBe(-12); // closer to -12 than -36
    expect(snapCoord(-36)).toBe(-36);
    expect(snapCoord(-48)).toBe(-36); // closer to -36
  });

  it("works for large values", () => {
    // 996 = 12 + 24*41 → already on dot
    expect(snapCoord(996)).toBe(996);
    // 1000 → nearest dot: (1000-12)/24 = 41.17 → round to 41 → 41*24+12 = 996
    expect(snapCoord(1000)).toBe(996);
    expect(isOnDot(snapCoord(1000))).toBe(true);
  });

  it("works for decimal inputs", () => {
    expect(isOnDot(snapCoord(12.7))).toBe(true);
    expect(isOnDot(snapCoord(35.1))).toBe(true);
    expect(isOnDot(snapCoord(-0.5))).toBe(true);
  });
});
