// [[C42]] htmlInCanvasRenderer, [[html-in-canvas#Drawing and the camera]]
import { describe, expect, it } from "vitest";
import { holderSyncTransform, holderTransform } from "../../src/graph/domSync";

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
