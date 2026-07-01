import { describe, it, expect } from "vitest";
import {
  worldToDevice, worldToCss, deviceToWorld, deviceMatrix, clipScaleOffset, overlayBus,
  type AreaTransform,
} from "./overlayTransform";

describe("worldToCss / worldToDevice", () => {
  it("identity transform, dpr 1: world == css == device", () => {
    const t: AreaTransform = { x: 0, y: 0, k: 1 };
    expect(worldToCss(t, 10, 20)).toEqual({ x: 10, y: 20 });
    expect(worldToDevice(t, 1, 10, 20)).toEqual({ x: 10, y: 20 });
  });

  it("applies pan then zoom in CSS space", () => {
    const t: AreaTransform = { x: 100, y: 50, k: 2 };
    // (wx*k + x, wy*k + y)
    expect(worldToCss(t, 10, 10)).toEqual({ x: 120, y: 70 });
  });

  it("device = css * dpr", () => {
    const t: AreaTransform = { x: 100, y: 50, k: 2 };
    const css = worldToCss(t, 10, 10);
    expect(worldToDevice(t, 3, 10, 10)).toEqual({ x: css.x * 3, y: css.y * 3 });
  });
});

describe("deviceToWorld", () => {
  it("inverts worldToDevice exactly for a spread of points", () => {
    const t: AreaTransform = { x: 137, y: -42, k: 1.75 };
    const dpr = 2;
    for (const [wx, wy] of [[0, 0], [10, -20], [-333, 512], [1.5, 2.5]]) {
      const d = worldToDevice(t, dpr, wx, wy);
      const back = deviceToWorld(t, dpr, d.x, d.y);
      expect(back.x).toBeCloseTo(wx, 9);
      expect(back.y).toBeCloseTo(wy, 9);
    }
  });

  it("guards k=0 (degenerate) instead of returning NaN", () => {
    const t: AreaTransform = { x: 5, y: 5, k: 0 };
    expect(deviceToWorld(t, 2, 100, 100)).toEqual({ x: 0, y: 0 });
  });
});

describe("deviceMatrix", () => {
  it("matches worldToDevice when applied as setTransform args", () => {
    const t: AreaTransform = { x: 60, y: 30, k: 1.5 };
    const dpr = 2;
    const [a, b, c, d, e, f] = deviceMatrix(t, dpr);
    // setTransform(a,b,c,d,e,f): screen = (a*wx + c*wy + e, b*wx + d*wy + f)
    const wx = 12, wy = -8;
    const sx = a * wx + c * wy + e;
    const sy = b * wx + d * wy + f;
    expect({ x: sx, y: sy }).toEqual(worldToDevice(t, dpr, wx, wy));
  });
});

describe("clipScaleOffset", () => {
  const apply = (t: AreaTransform, w: number, h: number, wx: number, wy: number) => {
    const { scale, offset } = clipScaleOffset(t, w, h);
    return { x: wx * scale[0] + offset[0], y: wy * scale[1] + offset[1] };
  };
  it("maps the CSS-px corners to clip-space corners", () => {
    const t: AreaTransform = { x: 0, y: 0, k: 1 };
    // World (0,0) is top-left CSS px → clip (-1, 1).
    expect(apply(t, 800, 600, 0, 0)).toEqual({ x: -1, y: 1 });
    // World (800,600) is bottom-right → clip (1, -1).
    const br = apply(t, 800, 600, 800, 600);
    expect(br.x).toBeCloseTo(1, 9);
    expect(br.y).toBeCloseTo(-1, 9);
    // Center → clip (0,0).
    const c = apply(t, 800, 600, 400, 300);
    expect(c.x).toBeCloseTo(0, 9);
    expect(c.y).toBeCloseTo(0, 9);
  });
  it("honors pan + zoom (matches worldToCss then NDC)", () => {
    const t: AreaTransform = { x: 120, y: -40, k: 1.5 };
    const W = 1000, H = 500, wx = 33, wy = 77;
    const css = worldToCss(t, wx, wy);
    const expected = { x: (css.x / W) * 2 - 1, y: 1 - (css.y / H) * 2 };
    const got = apply(t, W, H, wx, wy);
    expect(got.x).toBeCloseTo(expected.x, 9);
    expect(got.y).toBeCloseTo(expected.y, 9);
  });
});

describe("overlayBus", () => {
  it("dedups identical transforms (no notify) and fires on change", () => {
    let n = 0;
    const unsub = overlayBus.subscribe(() => { n++; });
    overlayBus.setTransform(1, 2, 3);
    expect(n).toBe(1);
    overlayBus.setTransform(1, 2, 3); // identical → no notify
    expect(n).toBe(1);
    overlayBus.setTransform(1, 2, 4); // changed
    expect(n).toBe(2);
    expect(overlayBus.get().transform).toEqual({ x: 1, y: 2, k: 4 });
    unsub();
  });

  it("dedups identical viewport+dpr", () => {
    let n = 0;
    const unsub = overlayBus.subscribe(() => { n++; });
    overlayBus.setViewport(800, 600, 2);
    overlayBus.setViewport(800, 600, 2);
    expect(n).toBe(1);
    overlayBus.setViewport(800, 600, 1); // dpr changed
    expect(n).toBe(2);
    unsub();
  });
});
