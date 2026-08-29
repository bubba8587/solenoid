import { describe, it, expect } from "vitest";
import { FLUIDS_FORMULAS } from "./fluids";
import { auditFormulaPack, entryByType, evalFormula, evalPackFormula } from "./formulaTestKit";
import { PIPE_ROUGHNESS, PipeRoughnessNode } from "../nodes/fluids";
import { ColebrookNode, colebrookF } from "../nodes/fluids";
import { isSolError } from "../errorValue";

const num = (type: string, inputs: Record<string, number>): number => {
  const r = evalFormula(entryByType(FLUIDS_FORMULAS, type), inputs);
  expect(typeof r, `${type} → ${JSON.stringify(r)}`).toBe("number");
  return r as number;
};

describe("Fluid Mechanics formulas", () => {
  it("every formula compiles and is well-formed", () => {
    expect(auditFormulaPack(FLUIDS_FORMULAS)).toEqual([]);
  });

  it("basics: Reynolds, viscosity, hydrostatic, flow", () => {
    // Water (998 kg/m³, 1 mPa·s) at 1 m/s in a 50 mm pipe.
    expect(num("fl-reynolds", { rho: 998, v: 1, d: 0.05, mu: 0.001 })).toBeCloseTo(49900, 0);
    expect(num("fl-kinematic-visc", { mu: 0.001, rho: 998 })).toBeCloseTo(1.002e-6, 9);
    // 10 m of water ≈ 0.979 bar.
    expect(num("fl-hydrostatic", { rho: 998, h: 10 })).toBeCloseTo(97870.4, 0);
    expect(num("fl-flow-rate", { v: 2, a: 0.01 })).toBeCloseTo(0.02, 9);
    expect(num("fl-velocity", { q: 0.02, a: 0.01 })).toBeCloseTo(2, 9);
    expect(num("fl-mass-flow", { rho: 998, q: 0.02 })).toBeCloseTo(19.96, 9);
    expect(num("fl-continuity", { v1: 1, a1: 0.02, a2: 0.01 })).toBeCloseTo(2, 9);
  });

  it("Bernoulli: pure velocity trade at equal elevation", () => {
    // 100 kPa, 1 → 2 m/s: p2 = 100000 + 499·(1−4) = 98503.
    expect(num("fl-bernoulli", { p1: 100000, rho: 998, v1: 1, v2: 2, z1: 0, z2: 0 })).toBeCloseTo(98503, 0);
  });

  it("pipe friction chain: f → Δp", () => {
    expect(num("fl-laminar-f", { re: 1000 })).toBeCloseTo(0.064, 9);
    const f = num("fl-swamee-jain", { re: 49900, rr: 0.0009 });
    expect(f).toBeCloseTo(0.0235, 2);
    // 100 m of 50 mm pipe at that f: Δp = f·(L/D)·ρv²/2.
    const dp = num("fl-darcy", { f, len: 100, d: 0.05, rho: 998, v: 1 });
    expect(dp).toBeCloseTo(f * 2000 * 499, 0);
    // Hazen-Williams: 100 m of 100 mm C=120 pipe at 10 L/s (v ≈ 1.27 m/s) → 2.21 m.
    expect(num("fl-hazen-williams", { len: 100, q: 0.01, c: 120, d: 0.1 })).toBeCloseTo(2.206, 2);
    // Poiseuille: 1 mm radius, 1 Pa·s, 1 m, 1 kPa → π·10³·10⁻¹²/8 = 3.93e-10 m³/s.
    expect(num("fl-poiseuille", { dp: 1000, r: 0.001, mu: 1, len: 1 })).toBeCloseTo(3.927e-10, 12);
  });

  it("pumps & orifices", () => {
    // Sharp orifice, 1 cm², 1 bar across, water → 8.5e-4 m³/s.
    expect(num("fl-orifice", { cd: 0.6, a: 1e-4, dp: 1e5, rho: 998 })).toBeCloseTo(8.494e-4, 6);
    // 20 L/s to 30 m head → 5.87 kW hydraulic; 7.83 kW at 75% efficiency.
    const ph = num("fl-pump-hydraulic", { rho: 998, q: 0.02, head: 30 });
    expect(ph).toBeCloseTo(5872.2, 0);
    expect(num("fl-pump-shaft", { rho: 998, q: 0.02, head: 30, eta: 0.75 })).toBeCloseTo(ph / 0.75, 6);
  });

  it("aero & particles", () => {
    // Cyclist: 0.5 m² · Cd 0.9 at 10 m/s in air 1.225 → 27.6 N.
    expect(num("fl-drag", { rho: 1.225, v: 10, cd: 0.9, a: 0.5 })).toBeCloseTo(27.56, 1);
    // 100 µm sand (2650) in water (998, 1 mPa·s) → 9.0 mm/s.
    expect(num("fl-stokes", { d: 100e-6, rhop: 2650, rhof: 998, mu: 0.001 })).toBeCloseTo(9.0e-3, 4);
    // Air at 15 °C → 340.3 m/s (the ISA sea-level value).
    expect(num("fl-speed-sound", { gamma: 1.4, rspec: 287.05, tk: 288.15 })).toBeCloseTo(340.3, 1);
    expect(num("fl-mach", { v: 340.3, gamma: 1.4, rspec: 287.05, tk: 288.15 })).toBeCloseTo(1, 3);
  });
});

describe("Colebrook friction factor", () => {
  it("satisfies the Colebrook residual to machine precision", () => {
    for (const [re, rr] of [[1e5, 1e-4], [1e5, 1e-3], [1e7, 1e-5], [4e3, 0.05]] as const) {
      const f = colebrookF(re, rr);
      const lhs = 1 / Math.sqrt(f);
      const rhs = -2 * Math.log10(rr / 3.7 + 2.51 / (re * Math.sqrt(f)));
      expect(Math.abs(lhs - rhs), `Re=${re} rr=${rr}`).toBeLessThan(1e-9);
    }
  });

  it("agrees with Swamee–Jain within ~2%", () => {
    const f = colebrookF(49900, 0.0009);
    const sj = 0.25 / Math.log10(0.0009 / 3.7 + 5.74 / 49900 ** 0.9) ** 2;
    expect(Math.abs(f - sj) / f).toBeLessThan(0.02);
  });

  it("node: laminar handoff, domain errors, unwired defaults", () => {
    const n = new ColebrookNode();
    expect(n.data({ re: [1000], rr: [0] }).result).toBeCloseTo(0.064, 9);
    expect(isSolError(n.data({ re: [-5], rr: [0] }).result)).toBe(true);
    expect(isSolError(n.data({ re: [1e5], rr: [1.5] }).result)).toBe(true);
    const dflt = n.data({});
    expect(typeof dflt.result).toBe("number"); // literal defaults compute
  });
});

describe("Pipe Roughness", () => {
  it("carries the textbook values, sorted smooth to rough", () => {
    const byId = Object.fromEntries(PIPE_ROUGHNESS.map((r) => [r.id, r.mm]));
    expect(byId.pvc).toBe(0.0015);
    expect(byId.steel).toBe(0.045);
    expect(byId.castiron).toBe(0.26);
    for (let i = 1; i < PIPE_ROUGHNESS.length; i++) {
      expect(PIPE_ROUGHNESS[i].mm).toBeGreaterThanOrEqual(PIPE_ROUGHNESS[i - 1].mm);
    }
  });

  it("emits ε and, with a diameter, the ε/D that feeds Colebrook", () => {
    const n = new PipeRoughnessNode({ material: "steel" });
    const bare = n.data({});
    expect(bare.eps).toBe(0.045);
    expect(bare.rel).toBeNull();
    const withD = n.data({ d: [100] }); // 100 mm pipe
    expect(withD.rel as number).toBeCloseTo(0.00045, 9);
  });
});

describe("pack formula functions (formulaNaming decision 4)", () => {
  it("COLEBROOK matches the node core, laminar hand-off included", () => {
    expect(evalPackFormula("COLEBROOK(100000, 0.0001)")).toBe(colebrookF(100000, 0.0001));
    expect(evalPackFormula("COLEBROOK(1000, 0)")).toBeCloseTo(0.064, 12);
    const bad = evalPackFormula("COLEBROOK(-5, 0)");
    expect(isSolError(bad) && bad.code).toBe("#DOMAIN!");
  });
  it("PIPEROUGHNESS looks up the material's absolute roughness in mm", () => {
    expect(evalPackFormula('PIPEROUGHNESS("steel")')).toBe(0.045);
    const bad = evalPackFormula('PIPEROUGHNESS("adamantium")');
    expect(isSolError(bad) && bad.code).toBe("#NAME?");
  });
});
