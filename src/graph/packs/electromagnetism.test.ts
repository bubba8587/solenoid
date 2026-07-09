import { describe, it, expect } from "vitest";
import { EM_FORMULAS, ELECTROMAGNETISM_PACK } from "./electromagnetism";
import { auditFormulaPack, entryByType, evalFormula } from "./formulaTestKit";
import { PHYS_CONSTANTS, PhysicsConstantNode } from "../rete-nodes";

const num = (type: string, inputs: Record<string, number>): number => {
  const r = evalFormula(entryByType(EM_FORMULAS, type), inputs);
  expect(typeof r, `${type} → ${JSON.stringify(r)}`).toBe("number");
  return r as number;
};

describe("Electromagnetism formulas", () => {
  it("every formula compiles and is well-formed", () => {
    expect(auditFormulaPack(EM_FORMULAS)).toEqual([]);
  });

  it("electrostatics reference values", () => {
    // Two 1 µC charges 1 m apart → 8.9876 mN.
    expect(num("em-coulomb-force", { q1: 1e-6, q2: 1e-6, r: 1 })).toBeCloseTo(8.98755e-3, 7);
    expect(num("em-e-field", { q: 1e-6, r: 1 })).toBeCloseTo(8987.55, 1);
    expect(num("em-e-potential", { q: 1e-6, r: 1 })).toBeCloseTo(8987.55, 1);
    // 100 cm² plates, 1 mm air gap → 88.54 pF.
    expect(num("em-plate-capacitance", { er: 1, a: 0.01, d: 0.001 })).toBeCloseTo(88.54e-12, 13);
    // 1 MV/m field → 4.427 J/m³.
    expect(num("em-e-energy-density", { ef: 1e6 })).toBeCloseTo(4.4271, 3);
  });

  it("magnetism reference values", () => {
    // 100 turns, 1 cm² core, 10 cm long → 12.57 µH.
    expect(num("em-solenoid-inductance", { n: 100, a: 1e-4, len: 0.1 })).toBeCloseTo(1.2566e-5, 9);
    // 1000 turns/m at 1 A → 1.2566 mT.
    expect(num("em-solenoid-field", { n: 1000, i: 1 })).toBeCloseTo(1.2566e-3, 7);
    // 1 A wire at 1 cm → 20 µT (the classic value).
    expect(num("em-wire-field", { i: 1, r: 0.01 })).toBeCloseTo(2e-5, 9);
    expect(num("em-loop-field", { i: 1, r: 0.01 })).toBeCloseTo(6.2832e-5, 8);
    // F = BIL·sin90 — 1 T, 10 A, 0.5 m → 5 N.
    expect(num("em-wire-force", { b: 1, i: 10, len: 0.5, theta: Math.PI / 2 })).toBeCloseTo(5, 9);
    expect(num("em-lorentz", { q: 1.602176634e-19, v: 1e6, b: 1, theta: Math.PI / 2 })).toBeCloseTo(1.602e-13, 15);
    // Electron in 1 T → 27.99 GHz.
    expect(num("em-cyclotron", { q: 1.602176634e-19, b: 1, m: 9.1093837015e-31 })).toBeCloseTo(2.7993e10, -7);
    expect(num("em-b-energy-density", { b: 1 })).toBeCloseTo(397887.4, 0);
  });

  it("waves & photons reference values", () => {
    // 100 MHz FM → 3.00 m; and the inverse round-trips.
    expect(num("em-wavelength", { f: 1e8 })).toBeCloseTo(2.99792458, 6);
    expect(num("em-frequency", { lambda: 2.99792458 })).toBeCloseTo(1e8, -1);
    // Green 500 nm photon → 3.973e-19 J.
    expect(num("em-photon-energy-wl", { lambda: 500e-9 })).toBeCloseTo(3.9729e-19, 21);
    expect(num("em-photon-energy", { f: 5e14 })).toBeCloseTo(3.313e-19, 21);
    // Copper at 50 Hz → 9.22 mm (the textbook mains skin depth).
    expect(num("em-skin-depth", { rho: 1.724e-8, f: 50, mur: 1 })).toBeCloseTo(9.348e-3, 4);
  });

  it("induction reference values", () => {
    expect(num("em-faraday-emf", { n: 100, dphi: 0.01, dt: 0.1 })).toBeCloseTo(-10, 9);
    expect(num("em-transformer", { vp: 230, np: 1000, ns: 50 })).toBeCloseTo(11.5, 9);
  });
});

describe("Physics Constant node", () => {
  it("CODATA exact values", () => {
    expect(new PhysicsConstantNode({ op: "c" }).data().value).toBe(299792458);
    expect(new PhysicsConstantNode({ op: "e" }).data().value).toBe(1.602176634e-19);
    expect(new PhysicsConstantNode({ op: "kb" }).data().value).toBe(1.380649e-23);
    expect(new PhysicsConstantNode({ op: "na" }).data().value).toBe(6.02214076e23);
  });

  it("derived constants are self-consistent", () => {
    // c² · ε₀ · µ₀ = 1
    const { eps0, mu0, c } = { eps0: PHYS_CONSTANTS.eps0.value, mu0: PHYS_CONSTANTS.mu0.value, c: PHYS_CONSTANTS.c.value };
    expect(c * c * eps0 * mu0).toBeCloseTo(1, 9);
    // kₑ = 1/(4πε₀)
    expect(1 / (4 * Math.PI * eps0)).toBeCloseTo(PHYS_CONSTANTS.ke.value, 0);
    // Z₀ = µ₀·c
    expect(mu0 * c).toBeCloseTo(PHYS_CONSTANTS.z0.value, 6);
    // R = Nₐ·k_B
    expect(PHYS_CONSTANTS.na.value * PHYS_CONSTANTS.kb.value).toBeCloseTo(PHYS_CONSTANTS.rgas.value, 6);
    // F = Nₐ·e
    expect(PHYS_CONSTANTS.na.value * PHYS_CONSTANTS.e.value).toBeCloseTo(PHYS_CONSTANTS.faraday.value, 4);
  });

  it("a stale op from an old save falls back instead of crashing", () => {
    const n = new PhysicsConstantNode({ op: "nope" as never });
    expect(n.op).toBe("c");
  });

  it("carries its unit like an FC lock: the annotation rides through a Display", async () => {
    const { NodeEditor, ClassicPreset } = await import("rete");
    const { makeAnnotationResolver } = await import("../unitFlow");
    const editor = new NodeEditor() as never as Parameters<typeof makeAnnotationResolver>[0];
    const c = new PhysicsConstantNode({ op: "c" });
    const disp = Object.assign(new ClassicPreset.Node("Display"), { passesUnitThrough: true });
    const sock = new (class extends ClassicPreset.Socket {})("any");
    disp.addInput("in", new ClassicPreset.Input(sock, "In"));
    disp.addOutput("out", new ClassicPreset.Output(sock, "Out"));
    await editor.addNode(c as never);
    await editor.addNode(disp as never);
    await editor.addConnection(new ClassicPreset.Connection(c as never, "value", disp as never, "in") as never);
    const r = makeAnnotationResolver(editor);
    const ann = r.inAnnotation(disp.id, "in");
    expect(ann?.unit).toBe("custom");
    expect(ann?.customUnit).toBe(" m/s");
  });
});

describe("pack wiring", () => {
  it("depends on the electricity pack", () => {
    expect(ELECTROMAGNETISM_PACK.dependsOn).toEqual(["electricity"]);
  });
});
