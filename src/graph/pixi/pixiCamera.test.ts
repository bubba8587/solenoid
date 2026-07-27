import { describe, it, expect } from "vitest";
import { Camera, clamp, pinchStep, panSweep } from "./pixiCamera";

describe("Camera", () => {
  it("round-trips world↔screen", () => {
    const cam = new Camera({ scale: 2, tx: 30, ty: -10 });
    const { sx, sy } = cam.toScreen(100, 50);
    expect(sx).toBe(230);
    expect(sy).toBe(90);
    const { wx, wy } = cam.toWorld(sx, sy);
    expect(wx).toBeCloseTo(100);
    expect(wy).toBeCloseTo(50);
  });

  it("pans by a screen delta", () => {
    const cam = new Camera({ scale: 1, tx: 0, ty: 0 });
    cam.panBy(15, -5);
    expect(cam.tx).toBe(15);
    expect(cam.ty).toBe(-5);
  });

  it("zooms about an anchor that stays fixed on screen", () => {
    const cam = new Camera({ scale: 1, tx: 0, ty: 0 });
    const anchor = { x: 400, y: 300 };
    const before = cam.toWorld(anchor.x, anchor.y);
    cam.zoomBy(2, anchor.x, anchor.y);
    expect(cam.scale).toBe(2);
    // The world point under the anchor must still map back to the anchor.
    const after = cam.toScreen(before.wx, before.wy);
    expect(after.sx).toBeCloseTo(anchor.x);
    expect(after.sy).toBeCloseTo(anchor.y);
  });

  it("clamps zoom to [minScale, maxScale]", () => {
    const cam = new Camera({ scale: 1, minScale: 0.5, maxScale: 4 });
    cam.zoomBy(100, 0, 0);
    expect(cam.scale).toBe(4);
    cam.zoomBy(0.0001, 0, 0);
    expect(cam.scale).toBe(0.5);
  });

  it("fits bounds centered with padding", () => {
    const cam = new Camera();
    cam.fit({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 800, 600, 50);
    // width-limited: (800-100)/1000 = 0.7 vs height (600-100)/500 = 1.0 → 0.7
    expect(cam.scale).toBeCloseTo(0.7);
    // center of bounds (500,250) maps to viewport center (400,300)
    const c = cam.toScreen(500, 250);
    expect(c.sx).toBeCloseTo(400);
    expect(c.sy).toBeCloseTo(300);
  });

  it("fit degrades gracefully on a zero-area bounds (centers at scale 1)", () => {
    const cam = new Camera();
    cam.fit({ minX: 100, minY: 100, maxX: 100, maxY: 100 }, 800, 600);
    expect(cam.scale).toBe(1);
    const c = cam.toScreen(100, 100);
    expect(c.sx).toBeCloseTo(400);
    expect(c.sy).toBeCloseTo(300);
  });

  it("seeds from an area transform", () => {
    const cam = new Camera();
    cam.setFromAreaTransform({ k: 1.5, x: 20, y: 40 });
    expect(cam.scale).toBe(1.5);
    expect(cam.tx).toBe(20);
    expect(cam.ty).toBe(40);
  });
});

describe("clamp", () => {
  it("bounds a value", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("panSweep", () => {
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 600 };

  it("centers the graph mid-sweep (t=0 → viewport center on graph center)", () => {
    const { tx, ty } = panSweep(bounds, 800, 600, 1, 0);
    const cam = new Camera({ scale: 1, tx, ty });
    const c = cam.toScreen(500, 300); // graph center
    expect(c.sx).toBeCloseTo(400);
    expect(c.sy).toBeCloseTo(300);
  });

  it("reaches the graph horizontal extremes during the sweep", () => {
    // sin(a) peaks at t=0.25 → viewport center sits on the graph's right edge.
    const { tx } = panSweep(bounds, 800, 600, 1, 0.25);
    const cam = new Camera({ scale: 1, tx, ty: 0 });
    const c = cam.toScreen(1000, 300); // right edge world x
    expect(c.sx).toBeCloseTo(400); // pulled to viewport center
  });

  it("scales the pan distance with zoom", () => {
    const a = panSweep(bounds, 800, 600, 1, 0.1);
    const b = panSweep(bounds, 800, 600, 2, 0.1);
    // higher zoom ⇒ the same world offset is a larger screen-space translation
    expect(Math.abs(b.tx - 400)).toBeGreaterThan(Math.abs(a.tx - 400));
  });
});

describe("pinchStep", () => {
  it("computes a zoom factor from the distance ratio", () => {
    const r = pinchStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 50, { x: 25, y: 0 });
    expect(r.dist).toBe(100);
    expect(r.factor).toBe(2); // 100/50
    expect(r.mid).toEqual({ x: 50, y: 0 });
    expect(r.panX).toBe(25); // 50 - 25
  });

  it("guards a zero previous distance", () => {
    const r = pinchStep({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, { x: 5, y: 0 });
    expect(Number.isFinite(r.factor)).toBe(true);
  });
});
