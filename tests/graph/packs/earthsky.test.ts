import { describe, it, expect } from "vitest";
import { EARTHSKY_FORMULAS } from "../../../src/graph/packs/earthsky";
import { auditFormulaPack, entryByType, evalFormula, evalPackFormula } from "../../../src/graph/packs/formulaTestKit";
import { SunriseSunsetNode } from "../../../src/graph/nodes/astro";
import { coreFunction } from "../coreFunction";
import { isSolError } from "../../../src/graph/errorValue";

const call = (name: string, ...a: unknown[]) => coreFunction(name)!(...a) as number;
const solarPosition = (w: number, lat: number, lon: number) =>
  ({ elevation: call("SUNPOSITION", w, lat, lon, "elevation"), azimuth: call("SUNPOSITION", w, lat, lon, "azimuth") });
const sunTimes = (w: number, lat: number, lon: number) =>
  ({ sunrise: call("SUNRISE", w, lat, lon) as number | null, sunset: call("SUNSET", w, lat, lon) as number | null, dayLength: call("DAYLENGTH", w, lat, lon) });
const moonPhase = (w: number) =>
  ({ phase: call("MOONPHASE", w, "phase"), age: call("MOONPHASE", w, "age"), illumination: call("MOONPHASE", w, "illumination") });

const num = (type: string, inputs: Record<string, number>): number => {
  const r = evalFormula(entryByType(EARTHSKY_FORMULAS, type), inputs);
  expect(typeof r, `${type} → ${JSON.stringify(r)}`).toBe("number");
  return r as number;
};

/** UTC date+time → Excel serial (serial 25569 = 1970-01-01). */
const serial = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) / 86400000 + 25569;

describe("Earth & Sky formulas", () => {
  it("every formula compiles and is well-formed", () => {
    expect(auditFormulaPack(EARTHSKY_FORMULAS)).toEqual([]);
  });

  it("haversine + bearing: London → New York", () => {
    // 51.5074,-0.1278 → 40.7128,-74.0060: ~5570 km, initial bearing ~288°.
    const d = num("es-haversine", { lat1: 51.5074, lon1: -0.1278, lat2: 40.7128, lon2: -74.006 });
    expect(d).toBeCloseTo(5570, -1);
    const b = num("es-bearing", { lat1: 51.5074, lon1: -0.1278, lat2: 40.7128, lon2: -74.006 });
    expect(b).toBeCloseTo(288.3, 0);
    // Due east along the equator.
    expect(num("es-bearing", { lat1: 0, lon1: 0, lat2: 0, lon2: 10 })).toBeCloseTo(90, 3);
  });

  it("gravity: equator/pole/altitude anchors", () => {
    expect(num("es-gravity", { lat: 0, h: 0 })).toBeCloseTo(9.7803, 3);
    expect(num("es-gravity", { lat: 90, h: 0 })).toBeCloseTo(9.8322, 3);
    expect(num("es-gravity", { lat: 45, h: 0 })).toBeCloseTo(9.8062, 3);
    // Everest summit sits ~0.027 m/s² lighter than its sea level.
    expect(num("es-gravity", { lat: 28, h: 0 }) - num("es-gravity", { lat: 28, h: 8849 })).toBeCloseTo(0.0273, 3);
  });

  it("horizon: 2 m eye height → ~5 km", () => {
    expect(num("es-horizon", { h: 2 })).toBeCloseTo(5.05, 1);
  });

  it("orbits: Earth anchors", () => {
    const ME = 5.9722e24, RE = 6.371e6;
    expect(num("es-escape-velocity", { m: ME, r: RE })).toBeCloseTo(11186, -2); // 11.2 km/s
    expect(num("es-orbital-velocity", { m: ME, r: RE + 400e3 })).toBeCloseTo(7669, -2); // ISS
    // ISS period ≈ 92.5 min.
    expect(num("es-orbital-period", { m: ME, r: RE + 400e3 }) / 60).toBeCloseTo(92.4, 0);
    // Geostationary: solve for T = 86164 s → r ≈ 42,164 km (checked via period at that r).
    expect(num("es-orbital-period", { m: ME, r: 42.164e6 })).toBeCloseTo(86164, -3);
    // The Sun's Schwarzschild radius ≈ 2.95 km.
    expect(num("es-schwarzschild", { m: 1.989e30 })).toBeCloseTo(2953, -2);
  });
});

describe("NOAA solar formulation", () => {
  it("declination hits the solstice/equinox anchors (noon elevation on the equator is 90° − |δ|)", () => {
    expect(solarPosition(serial(2026, 6, 21, 12, 2), 0, 0).elevation).toBeCloseTo(90 - 23.43, 1);
    expect(solarPosition(serial(2026, 12, 21, 11, 58), 0, 0).elevation).toBeCloseTo(90 - 23.43, 1);
    expect(solarPosition(serial(2026, 3, 20, 12, 8), 0, 0).elevation).toBeGreaterThan(89.5);
  });

  it("equation of time hits the February/November extremes (solar noon is 12:00 − EoT)", () => {
    const eqOfTimeMin = (w: number) => {
      const t = sunTimes(w, 0, 0);
      const noonHours = (((t.sunrise! + t.sunset!) / 2) % 1) * 24;
      return (12 - noonHours) * 60;
    };
    expect(eqOfTimeMin(serial(2026, 2, 11))).toBeCloseTo(-14.2, 0);
    expect(eqOfTimeMin(serial(2026, 11, 3))).toBeCloseTo(16.4, 0);
  });

  it("sun overhead at the equator at equinox solar noon", () => {
    // Greenwich meridian, equinox day, ~12:07 UTC (eq-of-time shifted noon).
    const p = solarPosition(serial(2026, 3, 20, 12, 8), 0, 0);
    expect(p.elevation).toBeGreaterThan(88);
  });

  it("azimuth: morning sun is in the east, afternoon in the west (northern midlats)", () => {
    const am = solarPosition(serial(2026, 6, 21, 8, 0), 51.5, 0);
    const pm = solarPosition(serial(2026, 6, 21, 16, 0), 51.5, 0);
    expect(am.azimuth).toBeGreaterThan(60);
    expect(am.azimuth).toBeLessThan(180);
    expect(pm.azimuth).toBeGreaterThan(180);
    expect(pm.azimuth).toBeLessThan(300);
  });

  it("day length: ~16.6 h in London on the June solstice, ~12 h at the equator, polar cases", () => {
    expect(sunTimes(serial(2026, 6, 21), 51.5, 0).dayLength).toBeCloseTo(16.64, 0);
    expect(sunTimes(serial(2026, 6, 21), 0, 0).dayLength).toBeCloseTo(12.1, 0);
    expect(sunTimes(serial(2026, 6, 21), 80, 0).dayLength).toBe(24); // polar day
    expect(sunTimes(serial(2026, 12, 21), 80, 0).dayLength).toBe(0); // polar night
  });

  it("London June-solstice sunrise ≈ 03:43 UTC", () => {
    const t = sunTimes(serial(2026, 6, 21), 51.5074, -0.1278);
    const sunriseUtcHours = ((t.sunrise! % 1) + 1) % 1 * 24;
    expect(sunriseUtcHours).toBeCloseTo(3.72, 1);
  });

  it("node: polar night yields blank rise/set, bad latitude errors", () => {
    const n = new SunriseSunsetNode();
    const polar = n.data({ when: [serial(2026, 12, 21)], lat: [80], lon: [0] });
    expect(polar.sunrise).toBe(null);
    expect(polar.daylength).toBe(0);
    expect(isSolError(n.data({ when: [serial(2026, 1, 1)], lat: [95], lon: [0] }).sunrise)).toBe(true);
  });
});

describe("moon phase", () => {
  it("reference new moon epoch and half-cycle full moon", () => {
    const epoch = 36531.7597;
    expect(moonPhase(epoch).phase).toBeCloseTo(0, 5);
    expect(moonPhase(epoch + 29.530588853 / 2).phase).toBeCloseTo(0.5, 5);
    expect(moonPhase(epoch + 29.530588853 / 2).illumination).toBeCloseTo(1, 5);
  });

  it("real events land within the approximation's tolerance", () => {
    // Total lunar eclipse (full moon) 2025-03-14; total solar eclipse (new moon) 2024-04-08.
    const full = moonPhase(serial(2025, 3, 14, 7));
    expect(Math.abs(full.phase - 0.5)).toBeLessThan(0.03);
    const nu = moonPhase(serial(2024, 4, 8, 18));
    expect(Math.min(nu.phase, 1 - nu.phase)).toBeLessThan(0.03);
  });
});

describe("pack formula functions ([[C51]] formulaNaming decision 4)", () => {
  it("SUNRISE / SUNSET / DAYLENGTH agree with the card at the equator", () => {
    const c = new SunriseSunsetNode().data({ when: [46000], lat: [0], lon: [0] });
    const t = { sunrise: c.sunrise, sunset: c.sunset, dayLength: c.daylength };
    expect(evalPackFormula("SUNRISE(46000, 0, 0)")).toBe(t.sunrise);
    expect(evalPackFormula("SUNSET(46000, 0, 0)")).toBe(t.sunset);
    expect(evalPackFormula("DAYLENGTH(46000, 0, 0)")).toBe(t.dayLength);
  });
  it("SUNPOSITION reads a part (elevation default); lat/lon are range-checked", () => {
    const p = solarPosition(46000.5, 40, -74);
    expect(evalPackFormula("SUNPOSITION(46000.5, 40, -74)")).toBe(p.elevation);
    expect(evalPackFormula('SUNPOSITION(46000.5, 40, -74, "azimuth")')).toBe(p.azimuth);
    const bad = evalPackFormula("SUNPOSITION(46000.5, 91, 0)");
    expect(isSolError(bad) && bad.code).toBe("#DOMAIN!");
  });
  it("MOONPHASE reads phase / age / illumination", () => {
    const m = moonPhase(46000);
    expect(evalPackFormula("MOONPHASE(46000)")).toBe(m.phase);
    expect(evalPackFormula('MOONPHASE(46000, "age")')).toBe(m.age);
    expect(m.age).toBeGreaterThanOrEqual(0);
    expect(m.age).toBeLessThan(29.6);
  });
});
