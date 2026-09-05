import { describe, expect, it, beforeEach } from "vitest";
import {
  drawnCablePath,
  drawnHeadings,
  drawnArrowHeads,
  arrowHeadPath,
  hasAngleOverride,
  type DrawnPoint,
} from "../../src/graph/drawnCablePath";
import {
  drawnCableStore, drawModeStore, nearestOption,
  DRAWN_WIDTHS, DRAWN_HEAD_SCALES, DRAWN_ANGLE_STEP,
} from "../../src/graph/drawnCables";
import type { CableShape } from "../../src/graph/cableShape";

const SHAPES: CableShape[] = ["spline", "straight", "diagonal"];

/** Every coordinate pair in the `d`, in order. */
function coords(d: string): DrawnPoint[] {
  const out: DrawnPoint[] = [];
  const re = /(-?[\d.]+),(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  return out;
}

const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

describe("drawnCablePath — the drawers, chained point to point", () => {
  const pts: DrawnPoint[] = [
    { x: 0, y: 0 },
    { x: 120, y: 60 },
    { x: 240, y: -40 },
    { x: 360, y: 90 },
  ];

  it("draws nothing below two points", () => {
    expect(drawnCablePath("spline", [])).toBe("");
    expect(drawnCablePath("spline", [{ x: 5, y: 5 }])).toBe("");
  });

  it("is ONE subpath: only the first command is a move", () => {
    for (const shape of SHAPES) {
      const d = drawnCablePath(shape, pts);
      expect(d.startsWith("M ")).toBe(true);
      // A second M would break marker/join behavior across the joints.
      expect(d.slice(1).includes("M")).toBe(false);
    }
  });

  it("starts and ends exactly on the first and last point", () => {
    for (const shape of SHAPES) {
      const c = coords(drawnCablePath(shape, pts));
      expect(near(c[0].x, pts[0].x)).toBe(true);
      expect(near(c[0].y, pts[0].y)).toBe(true);
      const last = c[c.length - 1];
      expect(near(last.x, pts[pts.length - 1].x)).toBe(true);
      expect(near(last.y, pts[pts.length - 1].y)).toBe(true);
    }
  });

  it("passes through every interior point", () => {
    for (const shape of SHAPES) {
      const c = coords(drawnCablePath(shape, pts));
      for (const p of pts.slice(1, -1)) {
        expect(c.some((q) => near(q.x, p.x, 0.1) && near(q.y, p.y, 0.1))).toBe(true);
      }
    }
  });

  it("uses one drawer call per span, so N points give N-1 spans", () => {
    // Each span's own `M` becomes an `L`; a 4-point run has 3 spans, so exactly
    // 2 seam lines are introduced beyond whatever the drawers emit for 2 points.
    const two = drawnCablePath("diagonal", pts.slice(0, 2));
    const four = drawnCablePath("diagonal", pts);
    expect(four.length).toBeGreaterThan(two.length);
  });
});

describe("drawnHeadings — the shared tangent at each joint", () => {
  it("an interior point takes the chord through its neighbours", () => {
    // Both spans are handed the SAME heading at the shared point, which is what
    // keeps the drawers' rigid end stubs collinear (no kink at the joint).
    const h = drawnHeadings([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    expect(h).toEqual([0, 0, 0]);
  });

  it("the ends take their own span", () => {
    const h = drawnHeadings([{ x: 0, y: 0 }, { x: 0, y: 10 }]);
    expect(near(h[0], 90)).toBe(true);
    expect(near(h[1], 90)).toBe(true);
  });

  it("a point's own angle REPLACES the derived chord", () => {
    const pts: DrawnPoint[] = [{ x: 0, y: 0 }, { x: 10, y: 0, angle: 90 }, { x: 20, y: 0 }];
    expect(drawnHeadings(pts)[1]).toBe(90);
    // Both spans at that point read the SAME entry, so an override rotates the cable
    // through the point instead of opening a kink.
    expect(drawnHeadings(pts)[0]).toBe(0);
  });

  it("survives coincident points without NaN", () => {
    const h = drawnHeadings([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }]);
    expect(h.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("arrowheads", () => {
  const pts: DrawnPoint[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

  it("none draws none, both draws two", () => {
    expect(drawnArrowHeads(pts, "none")).toHaveLength(0);
    expect(drawnArrowHeads(pts, "start")).toHaveLength(1);
    expect(drawnArrowHeads(pts, "end")).toHaveLength(1);
    expect(drawnArrowHeads(pts, "both")).toHaveLength(2);
  });

  it("the start head points BACK out of the cable, the end head forward", () => {
    const [start] = drawnArrowHeads(pts, "start");
    const [end] = drawnArrowHeads(pts, "end");
    expect(start.tip).toEqual(pts[0]);
    expect(near(((start.dirDeg % 360) + 360) % 360, 180)).toBe(true);
    expect(end.tip).toEqual(pts[1]);
    expect(near(((end.dirDeg % 360) + 360) % 360, 0)).toBe(true);
  });

  it("the head is a closed triangle with its tip on the endpoint", () => {
    const d = arrowHeadPath({ x: 10, y: 20 }, 0);
    expect(d.startsWith("M 10,20")).toBe(true);
    expect(d.trimEnd().endsWith("Z")).toBe(true);
    expect(coords(d)).toHaveLength(3);
  });

  it("scales about its tip, so sizing never moves the point it marks", () => {
    const tip = { x: 10, y: 20 };
    const small = coords(arrowHeadPath(tip, 0, 10, 5));
    const big = coords(arrowHeadPath(tip, 0, 20, 10));
    expect(big[0]).toEqual(small[0]);
    // Twice the length puts the base twice as far back.
    expect(near(tip.x - big[1].x, 2 * (tip.x - small[1].x))).toBe(true);
  });
});

describe("drawnCableStore", () => {
  beforeEach(() => {
    drawnCableStore.clear();
    drawModeStore.disarm();
  });

  it("refuses a cable with fewer than two points", () => {
    expect(drawnCableStore.add([{ x: 0, y: 0 }])).toBeNull();
    expect(drawnCableStore.isEmpty()).toBe(true);
  });

  it("keeps at least two points when removing", () => {
    const c = drawnCableStore.add([{ x: 0, y: 0 }, { x: 1, y: 1 }])!;
    drawnCableStore.removePoint(c.id, 0);
    expect(drawnCableStore.get(c.id)!.points).toHaveLength(2);
  });

  it("inserts a point inside the run only", () => {
    const c = drawnCableStore.add([{ x: 0, y: 0 }, { x: 10, y: 0 }])!;
    drawnCableStore.insertPoint(c.id, 1, { x: 5, y: 5 });
    expect(drawnCableStore.get(c.id)!.points).toHaveLength(3);
    // An end is not a span boundary: both refusals leave the run alone.
    drawnCableStore.insertPoint(c.id, 0, { x: -5, y: 0 });
    drawnCableStore.insertPoint(c.id, 3, { x: 15, y: 0 });
    expect(drawnCableStore.get(c.id)!.points).toHaveLength(3);
  });

  it("translates every point together", () => {
    const c = drawnCableStore.add([{ x: 0, y: 0 }, { x: 10, y: 0 }])!;
    drawnCableStore.translate(c.id, 5, -3);
    expect(drawnCableStore.get(c.id)!.points).toEqual([{ x: 5, y: -3 }, { x: 15, y: -3 }]);
  });

  it("round-trips a pinned heading", () => {
    const c = drawnCableStore.add([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])!;
    drawnCableStore.setPointAngle(c.id, 1, 135);
    const saved = drawnCableStore.serialize();
    // Only the pinned point carries an angle — an unset one stays absent.
    expect(saved[0].points[0].angle).toBeUndefined();
    expect(saved[0].points[1].angle).toBe(135);
    drawnCableStore.clear();
    drawnCableStore.load(saved);
    expect(drawnCableStore.all()[0].points[1].angle).toBe(135);
  });

  it("round-trips through serialize / load", () => {
    const c = drawnCableStore.add([{ x: 0, y: 0 }, { x: 10, y: 20 }], {
      shape: "straight",
      arrows: "both",
      width: 3.6,
      headScale: 1.5,
      color: "vermilion",
    })!;
    const saved = drawnCableStore.serialize();
    drawnCableStore.clear();
    expect(drawnCableStore.isEmpty()).toBe(true);
    drawnCableStore.load(saved);
    const back = drawnCableStore.all()[0];
    expect(back.points).toEqual(c.points);
    expect(back.shape).toBe("straight");
    expect(back.arrows).toBe("both");
    expect(back.width).toBe(3.6);
    expect(back.headScale).toBe(1.5);
    expect(back.color).toBe("vermilion");
  });

  // Author ruling, 2026-09-05: the angle dial steps in 45s, matching the standoff and
  // Conduit dials. A finer step was tried and rejected — this is the relapse guard.
  it("the angle dial steps in 45s", () => {
    expect(DRAWN_ANGLE_STEP).toBe(45);
  });

  it("pins and releases a point's heading", () => {
    const c = drawnCableStore.add([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])!;
    drawnCableStore.setPointAngle(c.id, 1, 90);
    expect(drawnCableStore.get(c.id)!.points[1].angle).toBe(90);
    expect(hasAngleOverride(drawnCableStore.get(c.id)!.points[1])).toBe(true);
    // Wrapped into [0, 360).
    drawnCableStore.setPointAngle(c.id, 1, -90);
    expect(drawnCableStore.get(c.id)!.points[1].angle).toBe(270);
    drawnCableStore.setPointAngle(c.id, 1, null);
    expect(hasAngleOverride(drawnCableStore.get(c.id)!.points[1])).toBe(false);
  });

  it("dragging a point keeps its pinned heading", () => {
    const c = drawnCableStore.add([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])!;
    drawnCableStore.setPointAngle(c.id, 1, 45);
    drawnCableStore.movePoint(c.id, 1, { x: 99, y: 99 });
    expect(drawnCableStore.get(c.id)!.points[1]).toEqual({ x: 99, y: 99, angle: 45 });
    drawnCableStore.translate(c.id, 1, 1);
    expect(drawnCableStore.get(c.id)!.points[1].angle).toBe(45);
  });

  it("the active point follows insertions and removals, never dangles", () => {
    const c = drawnCableStore.add([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])!;
    drawnCableStore.select(c.id);
    drawnCableStore.setActivePoint(2);
    drawnCableStore.insertPoint(c.id, 1, { x: 5, y: 5 });
    expect(drawnCableStore.activePoint()).toBe(3);
    drawnCableStore.removePoint(c.id, 1);
    expect(drawnCableStore.activePoint()).toBe(2);
    // Removing the active point itself leaves none selected.
    drawnCableStore.removePoint(c.id, 2);
    expect(drawnCableStore.activePoint()).toBeNull();
    // Out of range never sticks.
    drawnCableStore.setActivePoint(99);
    expect(drawnCableStore.activePoint()).toBeNull();
  });

  it("selecting another cable drops the active point", () => {
    const a = drawnCableStore.add([{ x: 0, y: 0 }, { x: 1, y: 1 }])!;
    const b = drawnCableStore.add([{ x: 5, y: 5 }, { x: 6, y: 6 }])!;
    drawnCableStore.select(a.id);
    drawnCableStore.setActivePoint(1);
    drawnCableStore.select(b.id);
    expect(drawnCableStore.activePoint()).toBeNull();
  });

  it("clamps width and head scale into range", () => {
    const c = drawnCableStore.add([{ x: 0, y: 0 }, { x: 1, y: 1 }])!;
    drawnCableStore.setWidth(c.id, 0);
    expect(drawnCableStore.get(c.id)!.width).toBeGreaterThan(0);
    drawnCableStore.setWidth(c.id, 1e6);
    expect(drawnCableStore.get(c.id)!.width).toBeLessThanOrEqual(40);
    drawnCableStore.setHeadScale(c.id, -3);
    expect(drawnCableStore.get(c.id)!.headScale).toBeGreaterThan(0);
  });

  it("a saved graph without the size fields loads at the defaults", () => {
    // Additive fields, pre-alpha: an older doc must still open, not fail.
    drawnCableStore.load([{ points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], shape: "spline" }]);
    const only = drawnCableStore.all()[0];
    expect(only.width).toBe(2.4);
    expect(only.headScale).toBe(1);
  });

  it("skips malformed saved entries instead of failing the load", () => {
    drawnCableStore.load([
      null,
      { points: [{ x: 0, y: 0 }] },
      { points: [{ x: 0, y: 0 }, { x: NaN, y: 1 }] },
      {
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        shape: "nonsense", arrows: "nope", color: 7, width: "fat", headScale: NaN,
      },
    ]);
    expect(drawnCableStore.all()).toHaveLength(1);
    const only = drawnCableStore.all()[0];
    expect(only.shape).toBe("spline");
    expect(only.arrows).toBe("end");
    expect(only.width).toBe(2.4);
    expect(only.headScale).toBe(1);
    expect(only.color).toBe("gray");
  });

  it("nearestOption snaps a hand-edited size to a listed one", () => {
    expect(nearestOption(DRAWN_WIDTHS, 2.5)).toBe(2.4);
    expect(nearestOption(DRAWN_WIDTHS, 99)).toBe(5.2);
    expect(nearestOption(DRAWN_HEAD_SCALES, 0)).toBe(0.7);
  });

  it("clears the selection when the selected cable goes", () => {
    const c = drawnCableStore.add([{ x: 0, y: 0 }, { x: 1, y: 1 }])!;
    drawnCableStore.select(c.id);
    expect(drawnCableStore.selected()).toBe(c.id);
    drawnCableStore.remove(c.id);
    expect(drawnCableStore.selected()).toBeNull();
  });
});

describe("drawModeStore", () => {
  beforeEach(() => {
    drawnCableStore.clear();
    drawModeStore.disarm();
  });

  it("places, undoes and finishes", () => {
    drawModeStore.arm();
    drawModeStore.place({ x: 0, y: 0 });
    drawModeStore.place({ x: 10, y: 0 });
    drawModeStore.place({ x: 20, y: 10 });
    drawModeStore.undoPoint();
    expect(drawModeStore.pending()).toHaveLength(2);
    expect(drawModeStore.finish()).not.toBeNull();
    // Still armed for the next run, with nothing pending.
    expect(drawModeStore.armed()).toBe(true);
    expect(drawModeStore.pending()).toHaveLength(0);
    expect(drawnCableStore.all()).toHaveLength(1);
  });

  it("finishing one point commits nothing", () => {
    drawModeStore.arm();
    drawModeStore.place({ x: 0, y: 0 });
    expect(drawModeStore.finish()).toBeNull();
    expect(drawnCableStore.isEmpty()).toBe(true);
  });

  it("disarming discards a half-drawn run", () => {
    drawModeStore.arm();
    drawModeStore.place({ x: 0, y: 0 });
    drawModeStore.place({ x: 10, y: 0 });
    drawModeStore.disarm();
    expect(drawnCableStore.isEmpty()).toBe(true);
    expect(drawModeStore.armed()).toBe(false);
  });

  it("ignores placement while disarmed", () => {
    drawModeStore.place({ x: 0, y: 0 });
    expect(drawModeStore.pending()).toHaveLength(0);
  });
});
