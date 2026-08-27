import { describe, it, expect } from "vitest";
import {
  conduitLaneOffset,
  CONDUIT_SQ,
  CONDUIT_COL_GAP,
  CONDUIT_ROW_GAP,
} from "./ribbonCable";

// conduitLaneOffset is THE lane geometry: ConduitComponent centres each painted
// socket square on it and FlowCableEdge lands each cable tip on it, so the two
// cannot drift. What this pins is the shape of that offset — pitch, symmetry, the
// in/out mirror, and rigid rotation — none of which any DOM measurement supplies.
// (Cable tips used to come from React Flow's measured handle box instead. It is
// re-measured only on a node version bump, so an expand left every tip on the
// collapsed geometry, and it stores the AABB of the ROTATED square, which inflates
// by √2 off-axis. Both put the tip off the pin hole it plugs into.)

const lay = (over: Partial<{ angle: number; scale: number; lanes: number }> = {}) =>
  ({ angle: 0, scale: 1, lanes: 3, ...over });

const COLUMN_HALF = (CONDUIT_SQ + CONDUIT_COL_GAP) / 2;
const ROW_PITCH = CONDUIT_SQ + CONDUIT_ROW_GAP;

describe("conduitLaneOffset — the Conduit's lane geometry", () => {
  it("puts the two columns either side of the pivot, one column-half out", () => {
    expect(conduitLaneOffset(lay({ lanes: 1 }), "in", 0)).toEqual({ x: -COLUMN_HALF, y: 0 });
    expect(conduitLaneOffset(lay({ lanes: 1 }), "out", 0)).toEqual({ x: COLUMN_HALF, y: 0 });
  });

  it("centres the lane stack on the pivot, at one square + gap of pitch", () => {
    const ys = [0, 1, 2].map((i) => conduitLaneOffset(lay(), "in", i).y);
    expect(ys).toEqual([-ROW_PITCH, 0, ROW_PITCH]);
    // Even lane counts straddle the pivot rather than sitting on it.
    const even = [0, 1].map((i) => conduitLaneOffset(lay({ lanes: 2 }), "in", i).y);
    expect(even).toEqual([-ROW_PITCH / 2, ROW_PITCH / 2]);
  });

  it("mirrors in against out across the pivot", () => {
    for (let i = 0; i < 3; i++) {
      const a = conduitLaneOffset(lay(), "in", i);
      const b = conduitLaneOffset(lay(), "out", i);
      expect(b.x).toBeCloseTo(-a.x, 10);
      expect(b.y).toBeCloseTo(a.y, 10);
    }
  });

  it("scales both axes by the collapse scale", () => {
    const SCALE = 0.6;
    const full = conduitLaneOffset(lay(), "out", 0);
    const small = conduitLaneOffset(lay({ scale: SCALE }), "out", 0);
    expect(small.x).toBeCloseTo(full.x * SCALE, 10);
    expect(small.y).toBeCloseTo(full.y * SCALE, 10);
  });

  it("rotates rigidly — the block turns, the lattice does not deform", () => {
    for (const angle of [45, 90, 135, 180, 270]) {
      for (const side of ["in", "out"] as const) {
        for (let i = 0; i < 3; i++) {
          const flat = conduitLaneOffset(lay(), side, i);
          const spun = conduitLaneOffset(lay({ angle }), side, i);
          // Same distance from the pivot, turned by exactly `angle` (CW, y-down).
          expect(Math.hypot(spun.x, spun.y)).toBeCloseTo(Math.hypot(flat.x, flat.y), 10);
          const rad = (angle * Math.PI) / 180;
          expect(spun.x).toBeCloseTo(flat.x * Math.cos(rad) - flat.y * Math.sin(rad), 10);
          expect(spun.y).toBeCloseTo(flat.x * Math.sin(rad) + flat.y * Math.cos(rad), 10);
        }
      }
    }
  });

  it("keeps neighbouring lanes exactly one pitch apart at any angle", () => {
    for (const angle of [0, 45, 90, 225]) {
      for (let i = 1; i < 3; i++) {
        const a = conduitLaneOffset(lay({ angle }), "in", i - 1);
        const b = conduitLaneOffset(lay({ angle }), "in", i);
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(ROW_PITCH, 10);
      }
    }
  });
});
