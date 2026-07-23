import { describe, expect, it } from "vitest";
import {
  camFromDrawMatrix,
  holderSyncTransform,
  holderTransform,
  plausibleNativeCam,
} from "./domSync";

describe("holderTransform", () => {
  it("matches rete-area-plugin's serialization exactly", () => {
    // rete: `translate(${x}px, ${y}px) scale(${k})`
    expect(holderTransform({ k: 0.5, x: 12, y: -3.25 })).toBe("translate(12px, -3.25px) scale(0.5)");
    expect(holderTransform({ k: 1, x: 0, y: 0 })).toBe("translate(0px, 0px) scale(1)");
  });
});

describe("holderSyncTransform", () => {
  it("null when nothing has been presented", () => {
    expect(holderSyncTransform({ k: 1, x: 0, y: 0 }, null)).toBeNull();
  });

  it("null when live and presented agree (within eps)", () => {
    const t = { k: 0.8, x: 100, y: 50 };
    expect(holderSyncTransform(t, { k: 0.8, x: 100.005, y: 49.995 })).toBeNull();
  });

  it("returns the presented transform when the pan skews past eps", () => {
    const live = { k: 1, x: 120, y: 0 };
    const presented = { k: 1, x: 100, y: 0 };
    expect(holderSyncTransform(live, presented)).toBe("translate(100px, 0px) scale(1)");
  });

  it("returns the presented transform on a zoom skew", () => {
    const live = { k: 1.1, x: 0, y: 0 };
    const presented = { k: 1, x: 0, y: 0 };
    expect(holderSyncTransform(live, presented)).toBe("translate(0px, 0px) scale(1)");
  });
});

describe("camFromDrawMatrix", () => {
  it("recovers the camera from a pure translate+scale matrix", () => {
    // camera k=0.5, t=(40,60); element anchored at world (200,100):
    // e = k*anchor + tx → 140, f = 110
    const cam = camFromDrawMatrix({ a: 0.5, b: 0, c: 0, d: 0.5, e: 140, f: 110 }, 200, 100);
    expect(cam).not.toBeNull();
    expect(cam!.k).toBeCloseTo(0.5);
    expect(cam!.x).toBeCloseTo(40);
    expect(cam!.y).toBeCloseTo(60);
  });

  it("rejects rotation/skew", () => {
    expect(camFromDrawMatrix({ a: 1, b: 0.1, c: 0, d: 1, e: 0, f: 0 }, 0, 0)).toBeNull();
    expect(camFromDrawMatrix({ a: 1, b: 0, c: 0.1, d: 1, e: 0, f: 0 }, 0, 0)).toBeNull();
  });

  it("rejects non-uniform or degenerate scale", () => {
    expect(camFromDrawMatrix({ a: 1, b: 0, c: 0, d: 2, e: 0, f: 0 }, 0, 0)).toBeNull();
    expect(camFromDrawMatrix({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, 0, 0)).toBeNull();
    expect(camFromDrawMatrix({ a: -1, b: 0, c: 0, d: -1, e: 0, f: 0 }, 0, 0)).toBeNull();
  });

  it("rejects non-finite components", () => {
    expect(camFromDrawMatrix({ a: NaN, b: 0, c: 0, d: 1, e: 0, f: 0 }, 0, 0)).toBeNull();
    expect(camFromDrawMatrix({ a: 1, b: 0, c: 0, d: 1, e: Infinity, f: 0 }, 0, 0)).toBeNull();
  });
});

describe("plausibleNativeCam", () => {
  const book = { k: 1, x: 100, y: 200 };

  it("accepts a native cam within rounding of the bookkeeping", () => {
    expect(plausibleNativeCam({ k: 1.001, x: 101, y: 199 }, book)).toBe(true);
  });

  it("rejects a wildly different scale (misparse — e.g. backing-store px)", () => {
    expect(plausibleNativeCam({ k: 2, x: 100, y: 200 }, book)).toBe(false);
  });

  it("rejects a translation far from the bookkeeping", () => {
    expect(plausibleNativeCam({ k: 1, x: 300, y: 200 }, book)).toBe(false);
  });
});
