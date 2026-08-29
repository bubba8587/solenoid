// Declared pack exceptions: implement the formulation, not the printed grid.

import { ClassicPreset } from "rete";
import { numIn, numOut, readInput } from "./shared";
import { solError, isSolError, type SolError } from "../errorValue";

// US Standard Atmosphere 1976, 0–86 km. Base pressures are DERIVED from the layer
// table at init, so no transcribed pressure constant can be typo'd. ISA's own
// constants: g₀ = 9.80665, M = 0.0289644 kg/mol, R* = 8.31432 J/(mol·K).

const ISA_R_SPEC = 287.0531; // R*/M, J/(kg·K)
const GM_OVER_R = 0.034163195; // g₀·M/R*, K/m
const EARTH_R = 6356766; // m, for geometric → geopotential

// [base geopotential altitude m, lapse rate K/m]; base temps chain from 288.15 K.
const ISA_LAYERS: Array<[number, number]> = [
  [0, -0.0065], [11000, 0], [20000, 0.001], [32000, 0.0028],
  [47000, 0], [51000, -0.0028], [71000, -0.002],
];
const ISA_TOP = 84852; // m geopotential (86 km geometric)

const ISA_BASES: Array<{ h: number; L: number; T: number; p: number }> = (() => {
  const out = [{ h: 0, L: ISA_LAYERS[0][1], T: 288.15, p: 101325 }];
  for (let i = 1; i < ISA_LAYERS.length; i++) {
    const prev = out[i - 1];
    const [h] = ISA_LAYERS[i];
    const dh = h - prev.h;
    const T = prev.T + prev.L * dh;
    const p = prev.L === 0
      ? prev.p * Math.exp((-GM_OVER_R * dh) / prev.T)
      : prev.p * (prev.T / T) ** (GM_OVER_R / prev.L);
    out.push({ h, L: ISA_LAYERS[i][1], T, p });
  }
  return out;
})();

export interface IsaPoint { T: number; p: number; rho: number; a: number }

/** Standard atmosphere at a GEOPOTENTIAL altitude (m). Exported for tests. */
export function isaAtGeopotential(h: number): IsaPoint {
  let layer = ISA_BASES[0];
  for (const b of ISA_BASES) { if (h >= b.h) layer = b; else break; }
  const dh = h - layer.h;
  const T = layer.T + layer.L * dh;
  const p = layer.L === 0
    ? layer.p * Math.exp((-GM_OVER_R * dh) / layer.T)
    : layer.p * (layer.T / T) ** (GM_OVER_R / layer.L);
  const rho = p / (ISA_R_SPEC * T);
  const a = Math.sqrt(1.4 * ISA_R_SPEC * T);
  return { T, p, rho, a };
}

/** Standard atmosphere at a GEOMETRIC altitude (m) — what an altimeter/GPS reads. */
export function isaAtGeometric(z: number): IsaPoint {
  return isaAtGeopotential((EARTH_R * z) / (EARTH_R + z));
}

/** Shared by the node and the pack's STANDARDATMOSPHERE formula; the −2…86 km
 *  domain is checked on the GEOPOTENTIAL altitude, like the tables. */
export function standardAtmosphere(z: number): IsaPoint | SolError {
  const h = (EARTH_R * z) / (EARTH_R + z);
  if (h < -2000 || h > ISA_TOP) {
    return solError("#DOMAIN!", "The 1976 standard atmosphere is defined from −2 to 86 km");
  }
  return isaAtGeopotential(h);
}

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

// log₁₀(p/mmHg) = A − B/(C + T°C), Lange's-handbook coefficient form. Each triple is
// validated in tests by reproducing its normal boiling point, so a typo can't ship.

export type AntoineOp =
  | "water" | "ethanol" | "methanol" | "isopropanol"
  | "acetone" | "benzene" | "toluene" | "hexane" | "ammonia";

export interface AntoineMeta { label: string; A: number; B: number; C: number; bp: number }

export const ANTOINE: Record<AntoineOp, AntoineMeta> = {
  water:       { label: "Water",       A: 8.07131, B: 1730.63,  C: 233.426, bp: 100.0 },
  ethanol:     { label: "Ethanol",     A: 8.20417, B: 1642.89,  C: 230.3,   bp: 78.37 },
  methanol:    { label: "Methanol",    A: 8.08097, B: 1582.271, C: 239.726, bp: 64.7 },
  isopropanol: { label: "Isopropanol", A: 8.11778, B: 1580.92,  C: 219.61,  bp: 82.3 },
  acetone:     { label: "Acetone",     A: 7.11714, B: 1210.595, C: 229.664, bp: 56.05 },
  benzene:     { label: "Benzene",     A: 6.90565, B: 1211.033, C: 220.79,  bp: 80.1 },
  toluene:     { label: "Toluene",     A: 6.95464, B: 1344.8,   C: 219.48,  bp: 110.6 },
  hexane:      { label: "n-Hexane",    A: 6.87601, B: 1171.17,  C: 224.41,  bp: 68.7 },
  ammonia:     { label: "Ammonia",     A: 7.3605,  B: 926.132,  C: 240.17,  bp: -33.34 },
};

const MMHG_TO_PA = 133.322387415;

/** Vapor pressure in Pa at t °C. Exported for tests. */
export function antoinePressure(op: AntoineOp, t: number): number {
  const { A, B, C } = ANTOINE[op];
  return MMHG_TO_PA * 10 ** (A - B / (C + t));
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
    this.substance = init?.substance && init.substance in ANTOINE ? init.substance : "water";
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
