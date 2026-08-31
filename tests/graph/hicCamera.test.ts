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

  it("clamps a construction scale to [minScale, maxScale]", () => {
    expect(new Camera({ scale: 100 }).scale).toBe(8);
    expect(new Camera({ scale: 0 }).scale).toBe(0.02);
  });
});
