// [[A1]] visualGraphCalculator, [[html-in-canvas#Big graphs can optionally pan and zoom on pictures of their nodes]], [[html-in-canvas#Drawing and the camera]]
import { describe, it, expect } from "vitest";
import { Camera } from "../../src/graph/hicCamera";

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
});
