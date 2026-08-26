import { describe, it, expect } from "vitest";
import { clampZoom, floorZoom, MIN_ZOOM, MAX_ZOOM, ZOOM_SNAP } from "./areaPresets";

// The camera rests only on multiples of ZOOM_SNAP; fits snap down so content still fits.
describe("zoom snap", () => {
  it("clampZoom snaps to the nearest step and stays in range", () => {
    expect(clampZoom(0.74)).toBeCloseTo(0.7, 10);
    expect(clampZoom(0.76)).toBeCloseTo(0.8, 10);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.01)).toBeCloseTo(MIN_ZOOM, 10);
    expect(clampZoom(9)).toBeCloseTo(MAX_ZOOM, 10);
  });
  it("floorZoom snaps down", () => {
    expect(floorZoom(0.79)).toBeCloseTo(0.7, 10);
    expect(floorZoom(0.8)).toBeCloseTo(0.8, 10);
    expect(floorZoom(0.02)).toBeCloseTo(MIN_ZOOM, 10);
  });
  it("the bounds are themselves on the grid", () => {
    expect(Math.round(MIN_ZOOM / ZOOM_SNAP) * ZOOM_SNAP).toBeCloseTo(MIN_ZOOM, 10);
    expect(Math.round(MAX_ZOOM / ZOOM_SNAP) * ZOOM_SNAP).toBeCloseTo(MAX_ZOOM, 10);
  });
});
