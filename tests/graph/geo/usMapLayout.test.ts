// [[C100]] chartIsAValue
// The US Map's projection and view box.
import { describe, it, expect } from "vitest";
import { albersUsa } from "../../../src/graph/geo/albersUsa";
import { usMapGeometry, placePins, zoomBox, panBox } from "../../../src/graph/geo/usMapLayout";

describe("Albers USA", () => {
  // d3-geo 3.1.1's geoAlbersUsa().scale(1300).translate([487.5, 305]) on the same points.
  it("puts a place where d3's projection does, Alaska and Hawaii in their insets", () => {
    const p = albersUsa();
    const cases: [number, number, number, number][] = [
      [-97.74, 30.27, 463.98, 497.39],
      [-149.9, 61.2, 112.29, 544.42],
      [-157.8, 21.3, 268.2, 549.35],
      [-176.6, 51.9, -12.49, 600.08],
    ];
    for (const [lon, lat, x, y] of cases) {
      const at = p.point(lon, lat)!;
      expect(at[0]).toBeCloseTo(x, 1);
      expect(at[1]).toBeCloseTo(y, 1);
    }
    expect(p.point(-99, 19.4)).toBeNull(); // Mexico City
    expect(p.point(0, 0)).toBeNull();
  });
});

describe("US Map layout", () => {
  it("draws the 48 and DC on Lower 48, and adds Alaska and Hawaii on All 50", () => {
    expect(usMapGeometry("lower48").paths).toHaveLength(49);
    expect(usMapGeometry("all50").paths).toHaveLength(51);
  });

  it("counts a place the scope can't hold as off the map", () => {
    const pins = { lat: [30.27, 61.2, 21.3, 19.4], lon: [-97.74, -149.9, -157.8, -99] };
    expect(placePins(pins, "lower48")).toMatchObject({ off: 3 });
    expect(placePins(pins, "all50").off).toBe(1);
    expect(placePins(pins, "all50").pins.map((p) => p.i)).toEqual([0, 1, 2]);
  });

  it("zooms about a point and never past the whole map or off its edge", () => {
    const home = { x: 0, y: 0, w: 100, h: 50 };
    const z = zoomBox(home, home, 2, 0.5, 0.5);
    expect(z).toEqual({ x: 25, y: 12.5, w: 50, h: 25 });
    expect(zoomBox(z, home, 0.1, 0, 0)).toEqual(home);
    expect(panBox(z, home, 1000, -1000)).toEqual({ x: 50, y: 0, w: 50, h: 25 });
  });
});
