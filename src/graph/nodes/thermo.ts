// [[C76]] formulaPackDefault, [[C17]] shareImpl

import { ClassicPreset } from "rete";
import { numIn, numOut, readInput } from "./shared";
import { solError, isSolError, type SolError } from "../errorValue";
import { standardAtmosphere, antoinePressure, ANTOINE, type AntoineOp } from "./thermoOps";

export class IsaAtmosphereNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { alt: 0 };
  cachedT: number | SolError | null = null;
  cachedP: number | SolError | null = null;
  cachedRho: number | SolError | null = null;
  cachedA: number | SolError | null = null;
  width = 220;
  height = 220;

  constructor(init?: { label?: string }) {
    super("IsaAtmosphere");
    this.label = init?.label ?? "Standard Atmosphere";
    this.addInput("alt", numIn("Altitude m"));
    this.addOutput("temp", numOut("T (K)"));
    this.addOutput("pressure", numOut("p (Pa)"));
    this.addOutput("density", numOut("ρ (kg/m³)"));
    this.addOutput("sound", numOut("a (m/s)"));
  }

  data(inputs: { alt?: (number | null)[] }) {
    const z = readInput(inputs.alt, this.literals.alt);
    let temp: number | SolError | null = null;
    let pressure: number | SolError | null = null;
    let density: number | SolError | null = null;
    let sound: number | SolError | null = null;
    if (typeof z === "number") {
      const pt = standardAtmosphere(z);
      if (isSolError(pt)) {
        temp = pressure = density = sound = pt;
      } else {
        temp = pt.T; pressure = pt.p; density = pt.rho; sound = pt.a;
      }
    }
    this.cachedT = temp; this.cachedP = pressure;
    this.cachedRho = density; this.cachedA = sound;
    return { temp, pressure, density, sound };
  }
}

export class AntoineNode extends ClassicPreset.Node {
  label: string;
  substance: AntoineOp;
  literals: Record<string, number> = { t: 25 };
  cachedP: number | SolError | null = null;
  cachedBp: number | null = null;
  width = 220;
  height = 190;

  constructor(init?: { label?: string; substance?: AntoineOp }) {
    super("Antoine");
    this.substance = init?.substance ?? "water";
    this.label = init?.label ?? "Vapor Pressure";
    this.addInput("t", numIn("T °C"));
    this.addOutput("pressure", numOut("p (Pa)"));
    this.addOutput("bp", numOut("Boiling °C"));
  }

  data(inputs: { t?: (number | null)[] }) {
    const t = readInput(inputs.t, this.literals.t);
    const { A, B, C } = ANTOINE[this.substance];
    let pressure: number | SolError | null = null;
    if (typeof t === "number") {
      pressure = t <= -C
        ? solError("#DOMAIN!", "Below the equation's temperature range")
        : antoinePressure(this.substance, t);
    }
    // Normal boiling point: solve A − B/(C+T) = log₁₀760.
    const bp = B / (A - Math.log10(760)) - C;
    this.cachedP = pressure;
    this.cachedBp = bp;
    return { pressure, bp };
  }
}
