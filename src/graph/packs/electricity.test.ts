import { describe, it, expect } from "vitest";
import { ELECTRICITY_FORMULAS } from "./electricity";
import { auditFormulaPack, entryByType, evalFormula, evalEquation } from "./formulaTestKit";
import { decodeResistor, ResistorCodeNode } from "../nodes/electrical";

const num = (type: string, inputs: Record<string, number>): number => {
  const r = evalFormula(entryByType(ELECTRICITY_FORMULAS, type), inputs);
  expect(typeof r, `${type} → ${JSON.stringify(r)}`).toBe("number");
  return r as number;
};

describe("Electricity & Circuits formulas", () => {
  it("every formula compiles and is well-formed", () => {
    expect(auditFormulaPack(ELECTRICITY_FORMULAS)).toEqual([]);
  });

  it("Ohm's law is ONE equation preset that solves all three ways + checks", () => {
    const ohm = entryByType(ELECTRICITY_FORMULAS, "elec-ohms-law");
    expect(evalEquation(ohm, { i: 2, r: 50 }).v).toBe(100);
    expect(evalEquation(ohm, { v: 100, r: 50 }).i).toBe(2);
    expect(evalEquation(ohm, { v: 100, i: 2 }).r).toBe(50);
    expect(evalEquation(ohm, { v: 100, i: 2, r: 50 }).holds).toBe(true);
    expect(evalEquation(ohm, { v: 100, i: 2, r: 51 }).holds).toBe(false);
  });

  it("power forms agree with each other", () => {
    // 12 V across 6 Ω → 2 A, 24 W by every form.
    expect(num("elec-power-vi", { v: 12, i: 2 })).toBe(24);
    expect(num("elec-power-i2r", { i: 2, r: 6 })).toBe(24);
    expect(num("elec-power-v2r", { v: 12, r: 6 })).toBe(24);
    expect(num("elec-energy", { p: 24, t: 10 })).toBe(240);
  });

  it("divider, LED resistor, wire resistance, battery life", () => {
    expect(num("elec-voltage-divider", { vin: 10, r1: 1000, r2: 1000 })).toBe(5);
    expect(num("elec-led-resistor", { vs: 5, vf: 2, i: 0.02 })).toBe(150);
    // 100 m of 1.5 mm² copper: 1.724e-8 · 100 / 1.5e-6 = 1.149 Ω
    expect(num("elec-wire-resistance", { rho: 1.724e-8, len: 100, a: 1.5e-6 })).toBeCloseTo(1.149, 3);
    expect(num("elec-battery-life", { mah: 2000, ma: 100 })).toBe(20);
  });

  it("stored energies", () => {
    expect(num("elec-cap-energy", { c: 1e-6, v: 100 })).toBeCloseTo(0.005, 9);
    expect(num("elec-ind-energy", { l: 0.01, i: 2 })).toBeCloseTo(0.02, 9);
  });

  it("reactance, impedance, resonance", () => {
    // 1 µF at 1 kHz → 159.15 Ω; 10 mH at 1 kHz → 62.83 Ω.
    expect(num("elec-cap-reactance", { f: 1000, c: 1e-6 })).toBeCloseTo(159.1549, 3);
    expect(num("elec-ind-reactance", { f: 1000, l: 0.01 })).toBeCloseTo(62.8319, 3);
    expect(num("elec-rlc-impedance", { r: 30, xl: 60, xc: 20 })).toBe(50); // 3-4-5
    // 1 mH + 1 µF → 5033 Hz (the classic LC pair).
    expect(num("elec-resonance", { l: 1e-3, c: 1e-6 })).toBeCloseTo(5032.92, 1);
  });

  it("transients hit the 63%/37% marks at t = τ", () => {
    expect(num("elec-rc-tau", { r: 10000, c: 1e-4 })).toBeCloseTo(1, 9);
    expect(num("elec-rl-tau", { l: 0.5, r: 100 })).toBeCloseTo(0.005, 9);
    expect(num("elec-cap-charge", { v0: 10, t: 1, r: 10000, c: 1e-4 })).toBeCloseTo(6.3212, 3);
    expect(num("elec-cap-discharge", { v0: 10, t: 1, r: 10000, c: 1e-4 })).toBeCloseTo(3.6788, 3);
    // The canonical 555 datasheet example: R1=1k, R2=10k, C=1µF → ~68.6 Hz.
    expect(num("elec-555-astable", { r1: 1000, r2: 10000, c: 1e-6 })).toBeCloseTo(68.571, 2);
  });

  it("decibels", () => {
    expect(num("elec-db-power", { p2: 100, p1: 1 })).toBeCloseTo(20, 9);
    expect(num("elec-db-voltage", { v2: 10, v1: 1 })).toBeCloseTo(20, 9);
    const dbm = entryByType(ELECTRICITY_FORMULAS, "elec-dbm-w");
    expect(evalEquation(dbm, { dbm: 30 }).w as number).toBeCloseTo(1, 9);
    expect(evalEquation(dbm, { dbm: 0 }).w as number).toBeCloseTo(0.001, 9);
    expect(evalEquation(dbm, { w: 1 }).dbm as number).toBeCloseTo(30, 9);
  });
});

describe("Resistor color code", () => {
  it("decodes the classics", () => {
    expect(decodeResistor("brown", "black", "", "red", "gold", false)).toEqual({ ohms: 1000, tolerance: 5 });
    expect(decodeResistor("yellow", "violet", "", "orange", "gold", false)).toEqual({ ohms: 47000, tolerance: 5 });
    expect(decodeResistor("orange", "orange", "", "brown", "silver", false)).toEqual({ ohms: 330, tolerance: 10 });
    // 5-band 1% precision part: 10.0 kΩ.
    expect(decodeResistor("brown", "black", "black", "red", "brown", true)).toEqual({ ohms: 10000, tolerance: 1 });
    // Gold multiplier divides: 4.7 Ω.
    const r = decodeResistor("yellow", "violet", "", "gold", "gold", false);
    expect((r as { ohms: number }).ohms).toBeCloseTo(4.7, 9);
  });

  it("the node wires band picks to its outputs", () => {
    const n = new ResistorCodeNode();
    // Defaults: brown black × red, gold → 1 kΩ ± 5%.
    expect(n.data()).toEqual({ ohms: 1000, tolerance: 5 });
    n.op = "5";
    n.stringLiterals = { b1: "brown", b2: "black", b3: "black", mult: "red", tol: "brown" };
    expect(n.data()).toEqual({ ohms: 10000, tolerance: 1 });
  });
});
