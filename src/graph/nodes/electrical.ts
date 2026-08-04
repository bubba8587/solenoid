// The Electricity pack's declared exceptions to the formula-preset default
// (docs/pack-architecture.md); registered always, so saved graphs survive pack-off.

import { ClassicPreset } from "rete";
import { listIn, numIn, numOut, readInput } from "./shared";
import { solError, isSolError, type SolError } from "../errorValue";
import { forAggregate } from "../valueKinds";

// Parallel Combine: 1 / Σ(1/xᵢ). A list REDUCER, so it can't be a pre-set Expression —
// the formula engine is strictly element-wise over lists.

export class ParallelCombineNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  width = 180;
  height = 140;

  constructor(init?: { label?: string }) {
    super("ParallelCombine");
    this.label = init?.label ?? "Parallel Combine";
    this.addInput("list", listIn("Values"));
    this.addOutput("result", numOut("Result"));
  }

  data(inputs: { list?: (number | null | SolError)[][] }) {
    const result = parallelCombine(inputs.list?.[0] ?? []);
    this.cachedResult = result;
    return { result };
  }
}

/** The parallel combination 1/Σ(1/xᵢ) — the node's core, shared with the pack's
 *  PARALLELCOMBINE formula. Aggregator policy: per-cell SolError propagates,
 *  null (missing) is skipped; empty → null. A 0 element short-circuits the
 *  whole combination to 0 (a 0 Ω branch) — computing through 1/0 = ∞ would trip
 *  the finite guard. Reciprocals cancelling (−R with +R) is #DIV/0!. */
export function parallelCombine(cells: readonly (number | null | SolError)[]): number | SolError | null {
  const prep = forAggregate([...cells]);
  if (prep.error) return prep.error;
  const arr = prep.nums;
  if (arr.length === 0) return null;
  if (arr.some((v) => v === 0)) return 0;
  const sum = arr.reduce((a, b) => a + 1 / b, 0);
  return sum === 0
    ? solError("#DIV/0!", "The reciprocals cancel out — the combination is undefined")
    : 1 / sum;
}

// Nearest IEC 60063 preferred value. E3–E24 are the published tables (they DEVIATE from
// the geometric series); E48/E96 follow 10^(k/N) exactly, so they're generated.

export type ESeriesOp = "E3" | "E6" | "E12" | "E24" | "E48" | "E96";

const E24_TABLE = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
  3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
];

function generated(n: 48 | 96): number[] {
  return Array.from({ length: n }, (_, k) => Number((10 ** (k / n)).toPrecision(3)));
}

export const E_SERIES: Record<ESeriesOp, number[]> = {
  E3:  [1.0, 2.2, 4.7],
  E6:  [1.0, 1.5, 2.2, 3.3, 4.7, 6.8],
  E12: E24_TABLE.filter((_, i) => i % 2 === 0),
  E24: E24_TABLE,
  E48: generated(48),
  E96: generated(96),
};

/** Nearest standard value in a series (log distance — 4.6k is "closer" to 4.7k
 *  than to 4.3k in ratio terms, which is what tolerance bands care about). */
export function nearestESeries(value: number, series: ESeriesOp): number {
  const decade = Math.floor(Math.log10(value));
  let best = NaN;
  let bestDist = Infinity;
  // Candidates from the adjacent decades too, so 9.8 can snap up to 10.
  for (const d of [decade - 1, decade, decade + 1]) {
    for (const m of E_SERIES[series]) {
      const cand = m * 10 ** d;
      const dist = Math.abs(Math.log(value / cand));
      if (dist < bestDist) { bestDist = dist; best = cand; }
    }
  }
  // Kill float dust from m·10^d (4.7 * 10^3 → 4700.000000000001).
  return Number(best.toPrecision(12));
}

export class ESeriesNode extends ClassicPreset.Node {
  label: string;
  op: ESeriesOp;
  literals: Record<string, number> = { value: 4600 };
  cachedNearest: number | SolError | null = null;
  cachedError: number | SolError | null = null;
  width = 200;
  height = 190;

  constructor(init?: { label?: string; op?: ESeriesOp }) {
    super("ESeries");
    this.label = init?.label ?? "E-Series Value";
    this.op = init?.op && init.op in E_SERIES ? init.op : "E24";
    this.addInput("value", numIn("Value"));
    this.addOutput("nearest", numOut("Nearest"));
    this.addOutput("errpct", numOut("Error %"));
  }

  data(inputs: { value?: (number | null)[] }) {
    const v = readInput(inputs.value, this.literals.value);
    let nearest: number | SolError | null = null;
    let errpct: number | SolError | null = null;
    if (typeof v === "number") {
      if (v > 0 && Number.isFinite(v)) {
        nearest = nearestESeries(v, this.op);
        errpct = ((nearest - v) / v) * 100;
      } else {
        nearest = errpct = solError("#DOMAIN!", "A component value must be a positive number");
      }
    }
    this.cachedNearest = nearest;
    this.cachedError = errpct;
    return { nearest, errpct };
  }
}

// Diameter/resistance are exact definitions; ampacity is the NEC 310.16 copper 75 °C
// column — a fact table, so gauges NEC doesn't list output blank rather than a guess.

const AWG_AMPACITY_75C: Record<number, number> = {
  [-3]: 230, [-2]: 200, [-1]: 175, 0: 150, 1: 130, 2: 115, 3: 100,
  4: 85, 6: 65, 8: 50, 10: 35, 12: 25, 14: 20, 16: 18, 18: 14,
};

export class AwgNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { gauge: 12 };
  cachedDiameter: number | SolError | null = null;
  cachedArea: number | SolError | null = null;
  cachedResistance: number | SolError | null = null;
  cachedAmpacity: number | null = null;
  width = 210;
  height = 220;

  constructor(init?: { label?: string }) {
    super("Awg");
    this.label = init?.label ?? "AWG Wire";
    this.addInput("gauge", numIn("Gauge"));
    this.addOutput("diameter", numOut("Ø mm"));
    this.addOutput("area", numOut("mm²"));
    this.addOutput("resistance", numOut("Ω/km"));
    this.addOutput("ampacity", numOut("Ampacity A"));
  }

  data(inputs: { gauge?: (number | null)[] }) {
    const n = readInput(inputs.gauge, this.literals.gauge);
    let diameter: number | SolError | null = null;
    let area: number | SolError | null = null;
    let resistance: number | SolError | null = null;
    let ampacity: number | null = null;
    if (typeof n === "number") {
      const w = awgWire(n);
      if (isSolError(w)) {
        diameter = area = resistance = w; // ampacity stays null, never an error
      } else {
        ({ diameter, area, resistance, ampacity } = w);
      }
    }
    this.cachedDiameter = diameter;
    this.cachedArea = area;
    this.cachedResistance = resistance;
    this.cachedAmpacity = ampacity;
    return { diameter, area, resistance, ampacity };
  }
}

/** Ø mm, area mm², Ω/km (ρ_cu = 1.724e-8 Ω·m); ampacity only for the table's INTEGER
 *  gauges, else null. #DOMAIN! outside 4/0 (−3) … 40. Fractional n allowed. */
export function awgWire(n: number): { diameter: number; area: number; resistance: number; ampacity: number | null } | SolError {
  if (!(n >= -3 && n <= 40)) return solError("#DOMAIN!", "AWG runs 4/0 (enter -3) through 40");
  const d = 0.127 * 92 ** ((36 - n) / 39);
  const a = (Math.PI / 4) * d * d;
  return { diameter: d, area: a, resistance: 17.24 / a, ampacity: Number.isInteger(n) ? AWG_AMPACITY_75C[n] ?? null : null };
}

// The IEC 60062 color code: digit bands + multiplier → ohms, tolerance band → ±%.

export const RESISTOR_DIGIT: Record<string, number> = {
  black: 0, brown: 1, red: 2, orange: 3, yellow: 4,
  green: 5, blue: 6, violet: 7, gray: 8, white: 9,
};
export const RESISTOR_MULT: Record<string, number> = {
  black: 1, brown: 10, red: 100, orange: 1e3, yellow: 1e4,
  green: 1e5, blue: 1e6, violet: 1e7, gray: 1e8, white: 1e9,
  gold: 0.1, silver: 0.01,
};
export const RESISTOR_TOL: Record<string, number> = {
  brown: 1, red: 2, green: 0.5, blue: 0.25, violet: 0.1, gray: 0.05,
  gold: 5, silver: 10,
};

/** ohms + tolerance for the chosen bands ("brown", "black", …). `five` reads a
 *  third digit band. */
export function decodeResistor(
  d1: string, d2: string, d3: string, mult: string, tol: string, five: boolean,
): { ohms: number; tolerance: number } | SolError {
  const digits = five ? [d1, d2, d3] : [d1, d2];
  let value = 0;
  for (const d of digits) {
    const v = RESISTOR_DIGIT[d];
    if (v === undefined) return solError("#VALUE!", `"${d}" is not a digit band color`);
    value = value * 10 + v;
  }
  const m = RESISTOR_MULT[mult];
  if (m === undefined) return solError("#VALUE!", `"${mult}" is not a multiplier band color`);
  const t = RESISTOR_TOL[tol];
  if (t === undefined) return solError("#VALUE!", `"${tol}" is not a tolerance band color`);
  return { ohms: value * m, tolerance: t };
}

export class ResistorCodeNode extends ClassicPreset.Node {
  label: string;
  /** Band count: "4" (two digits) or "5" (three digits). */
  op: "4" | "5";
  /** Band color picks — persisted with the node (b3 read only in 5-band). */
  stringLiterals: Record<string, string> = { b1: "brown", b2: "black", b3: "black", mult: "red", tol: "gold" };
  cachedOhms: number | SolError | null = null;
  cachedTol: number | SolError | null = null;
  width = 220;
  height = 230;

  constructor(init?: { label?: string; op?: "4" | "5"; stringLiterals?: Record<string, string> }) {
    super("ResistorCode");
    this.label = init?.label ?? "Resistor Color Code";
    this.op = init?.op === "5" ? "5" : "4";
    if (init?.stringLiterals) this.stringLiterals = { ...this.stringLiterals, ...init.stringLiterals };
    this.addOutput("ohms", numOut("Ω"));
    this.addOutput("tolerance", numOut("± %"));
  }

  data() {
    const L = this.stringLiterals;
    const r = decodeResistor(L.b1, L.b2, L.b3, L.mult, L.tol, this.op === "5");
    if ("code" in (r as object)) {
      this.cachedOhms = this.cachedTol = r as SolError;
      return { ohms: r as SolError, tolerance: r as SolError };
    }
    const { ohms, tolerance } = r as { ohms: number; tolerance: number };
    this.cachedOhms = ohms;
    this.cachedTol = tolerance;
    return { ohms, tolerance };
  }
}
