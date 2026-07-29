import { describe, it, expect } from "vitest";
import { THERMO_FORMULAS } from "./thermo";
import { auditFormulaPack, entryByType, evalFormula, evalEquation, evalPackFormula } from "./formulaTestKit";
import { isaAtGeopotential, isaAtGeometric, IsaAtmosphereNode, ANTOINE, antoinePressure, AntoineNode, type AntoineOp } from "../nodes/thermo";
import { isSolError } from "../errorValue";

const num = (type: string, inputs: Record<string, number>): number => {
  const r = evalFormula(entryByType(THERMO_FORMULAS, type), inputs);
  expect(typeof r, `${type} → ${JSON.stringify(r)}`).toBe("number");
  return r as number;
};

describe("Thermodynamics & Air formulas", () => {
  it("every formula compiles and is well-formed", () => {
    expect(auditFormulaPack(THERMO_FORMULAS)).toEqual([]);
  });

  it("ideal gas is ONE equation preset: one mole at STP occupies 22.7 L, any variable solvable", () => {
    const gas = entryByType(THERMO_FORMULAS, "th-ideal-gas");
    expect(evalEquation(gas, { n: 1, tk: 273.15, p: 100000 }).vol as number).toBeCloseTo(0.022711, 5);
    expect(evalEquation(gas, { n: 1, tk: 273.15, vol: 0.022711 }).p as number).toBeCloseTo(100000, -1);
    expect(evalEquation(gas, { p: 100000, vol: 0.022711, tk: 273.15 }).n as number).toBeCloseTo(1, 4);
    expect(evalEquation(gas, { p: 100000, vol: 0.022711, n: 1 }).tk as number).toBeCloseTo(273.15, 1);
    // The truth check is strict (relative 1e-9), so hand it the EXACT volume.
    const vExact = (1 * 8.314462618 * 273.15) / 100000;
    expect(evalEquation(gas, { p: 100000, vol: vExact, n: 1, tk: 273.15 }).holds).toBe(true);
    expect(evalEquation(gas, { p: 100000, vol: vExact * 1.01, n: 1, tk: 273.15 }).holds).toBe(false);
    // Sea-level air: 101325 Pa, 15 °C → 1.225 kg/m³.
    expect(num("th-air-density", { p: 101325, tk: 288.15 })).toBeCloseTo(1.225, 3);
  });

  it("heat transfer", () => {
    // Boil a litre: 1 kg × 4186 × 80 K = 334.9 kJ; then evaporate it: 2.257 MJ.
    expect(num("th-sensible-heat", { m: 1, cp: 4186, dt: 80 })).toBeCloseTo(334880, 0);
    expect(num("th-latent-heat", { m: 1, lh: 2.257e6 })).toBeCloseTo(2.257e6, 0);
    // 10 m² brick wall (k=0.6), 20 cm thick, ΔT 20 → 600 W.
    expect(num("th-conduction", { k: 0.6, a: 10, dt: 20, thick: 0.2 })).toBeCloseTo(600, 9);
    expect(num("th-convection", { hc: 10, a: 10, dt: 20 })).toBeCloseTo(2000, 9);
    // 1 m² blackbody at 373 K facing 293 K → ~680 W.
    expect(num("th-radiation", { eps: 1, a: 1, t1: 373, t2: 293 })).toBeCloseTo(679.5, 0);
    expect(num("th-thermal-resistance", { thick: 0.2, k: 0.6, a: 10 })).toBeCloseTo(0.0333, 3);
    expect(num("th-u-value", { rval: 5 })).toBeCloseTo(0.2, 9);
    // Coffee: 90 °C in a 20 °C room, k = 0.05/min, after 10 min → 62.5 °C.
    expect(num("th-newton-cooling", { ta: 20, t0: 90, kk: 0.05, t: 10 })).toBeCloseTo(62.46, 1);
    // 10 m steel rail warming 30 K → 3.6 mm.
    expect(num("th-expansion", { alpha: 12e-6, len: 10, dt: 30 })).toBeCloseTo(0.0036, 6);
  });

  it("humid air: Magnus round-trips and matches published points", () => {
    // 20 °C saturation ≈ 2334 Pa (Magnus AE form).
    expect(num("th-svp", { tc: 20 })).toBeCloseTo(2333.5, 0);
    // 20 °C at 60% RH → dew point 12.0 °C, and RH back-computes to 60.
    const td = num("th-dew-point", { tc: 20, rh: 60 });
    expect(td).toBeCloseTo(12.0, 1);
    expect(num("th-rh-from-dew", { td, tc: 20 })).toBeCloseTo(60, 6);
    // Humidity ratio at sea level with pv = 2 kPa → 12.5 g/kg.
    expect(num("th-humidity-ratio", { pv: 2000, p: 101325 })).toBeCloseTo(0.012524, 5);
    // Stull's own example: 20 °C, 50% → 13.7 °C.
    expect(num("th-wet-bulb", { tc: 20, rh: 50 })).toBeCloseTo(13.7, 1);
    // NWS chart: 90 °F at 70% → heat index ≈ 105-106 °F.
    expect(num("th-heat-index", { tf: 90, rh: 70 })).toBeCloseTo(105.7, 0);
    // Environment Canada chart: −10 °C at 30 km/h → −20.
    expect(num("th-wind-chill", { tc: -10, v: 30 })).toBeCloseTo(-19.5, 0);
  });
});

describe("ISA standard atmosphere", () => {
  it("matches the published layer-base pressures", () => {
    expect(isaAtGeopotential(0)).toMatchObject({ T: 288.15, p: 101325 });
    expect(isaAtGeopotential(0).rho).toBeCloseTo(1.225, 3);
    expect(isaAtGeopotential(0).a).toBeCloseTo(340.29, 1);
    expect(isaAtGeopotential(11000).T).toBeCloseTo(216.65, 2);
    expect(isaAtGeopotential(11000).p).toBeCloseTo(22632, 0);
    expect(isaAtGeopotential(20000).p).toBeCloseTo(5474.9, 0);
    expect(isaAtGeopotential(32000).p).toBeCloseTo(868.02, 1);
    expect(isaAtGeopotential(47000).p).toBeCloseTo(110.91, 1);
    expect(isaAtGeopotential(47000).T).toBeCloseTo(270.65, 2);
  });

  it("geometric input converts to geopotential (cruise altitude sanity)", () => {
    // 11,019 m geometric ≈ 11,000 m geopotential — the tropopause.
    expect(isaAtGeometric(11019).T).toBeCloseTo(216.65, 1);
    // 35,000 ft (10,668 m geopotential): T ≈ −54.3 °C, p ≈ 23.84 kPa.
    const cruise = isaAtGeopotential(10668);
    expect(cruise.T - 273.15).toBeCloseTo(-54.3, 0);
    expect(cruise.p).toBeCloseTo(23842, -2);
    // The geometric-input path sits a touch higher in pressure (h < z).
    expect(isaAtGeometric(10668).p).toBeGreaterThan(cruise.p);
  });

  it("node wires the four outputs and rejects out-of-range altitudes", () => {
    const n = new IsaAtmosphereNode();
    const r = n.data({ alt: [0] });
    expect(r.temp).toBeCloseTo(288.15, 9);
    expect(r.pressure).toBeCloseTo(101325, 9);
    expect(isSolError(n.data({ alt: [100000] }).temp)).toBe(true);
  });
});

describe("Antoine vapor pressure", () => {
  it("every substance reproduces its normal boiling point (typo guard)", () => {
    for (const [op, meta] of Object.entries(ANTOINE) as [AntoineOp, (typeof ANTOINE)[AntoineOp]][]) {
      const bp = meta.B / (meta.A - Math.log10(760)) - meta.C;
      expect(bp, `${op} boiling point`).toBeCloseTo(meta.bp, 0);
    }
  });

  it("water at 25 °C ≈ 3.17 kPa (within the Antoine fit's ~0.5%), at 100 °C = 1 atm", () => {
    const p25 = antoinePressure("water", 25);
    expect(Math.abs(p25 - 3169) / 3169).toBeLessThan(0.015);
    expect(antoinePressure("water", 100)).toBeCloseTo(101325, -3);
  });

  it("node outputs pressure + boiling point per substance", () => {
    const n = new AntoineNode({ op: "ethanol" });
    const r = n.data({ t: [25] });
    expect(r.pressure as number).toBeCloseTo(7833, -2); // ~7.8 kPa
    expect(r.bp).toBeCloseTo(78.37, 0);
    expect(isSolError(n.data({ t: [-500] }).pressure)).toBe(true);
  });
});

describe("pack formula functions (D19 decision 4)", () => {
  it("STANDARDATMOSPHERE reads sea level by property (pressure default)", () => {
    expect(evalPackFormula("STANDARDATMOSPHERE(0)")).toBeCloseTo(101325, 0);
    expect(evalPackFormula('STANDARDATMOSPHERE(0, "temp")')).toBeCloseTo(288.15, 6);
    const bad = evalPackFormula("STANDARDATMOSPHERE(100000)");
    expect(isSolError(bad) && bad.code).toBe("#DOMAIN!");
  });
  it("ANTOINE reproduces water's normal boiling point within a percent", () => {
    expect((evalPackFormula('ANTOINE("water", 100)') as number) / 101325).toBeCloseTo(1, 2);
    const bad = evalPackFormula('ANTOINE("mercury", 25)');
    expect(isSolError(bad) && bad.code).toBe("#NAME?");
  });
});
