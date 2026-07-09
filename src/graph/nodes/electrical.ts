// Custom-logic nodes for the Electricity & Circuits pack — the declared
// exceptions to the formula-preset default (docs/pack-architecture.md): a list
// reducer (Parallel Combine), and two embedded-dataset lookups (E-Series, AWG).
// Pure TypeScript, web-safe; registered always so saved graphs keep working
// with the pack switched off.

import { ClassicPreset } from "rete";
import { listIn, numIn, numOut, readInput } from "./shared";
import { solError, type SolError } from "../errorValue";
import { forAggregate } from "../valueKinds";

// ─── Parallel Combine ─────────────────────────────────────────────────────────
// 1 / Σ(1/xᵢ) — resistors in parallel, capacitors in series, springs in series,
// thermal resistances in parallel. A list reducer, so it can't be a pre-set
// Expression (the formula engine is strictly element-wise over lists).

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
    // Aggregator policy: per-cell SolError propagates, null (missing) is skipped.
    const prep = forAggregate(inputs.list?.[0] ?? []);
    if (prep.error) { this.cachedResult = prep.error; return { result: prep.error }; }
    const arr = prep.nums;
    let result: number | SolError | null = null;
    if (arr.length > 0) {
      // A 0 element short-circuits the whole combination to 0 (a 0 Ω branch);
      // computing through 1/0 = ∞ would trip the finite guard, so handle it.
      if (arr.some((v) => v === 0)) {
        result = 0;
      } else {
        const sum = arr.reduce((a, b) => a + 1 / b, 0);
        result = sum === 0
          ? solError("#DIV/0!", "The reciprocals cancel out — the combination is undefined")
          : 1 / sum;
      }
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── E-Series preferred value ─────────────────────────────────────────────────
// Nearest IEC 60063 standard component value (resistors, capacitors). E3–E24 are
// the historic published tables (they deviate from the pure geometric series —
// 2.7, 3.0, 3.3 …); E48/E96 follow 10^(k/N) rounded to 3 significant figures
// exactly, so they're generated.

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

// ─── AWG wire properties ──────────────────────────────────────────────────────
// American Wire Gauge n → the exact geometric definition d(mm) = 0.127·92^((36−n)/39),
// cross-section, and copper resistance at 20 °C (ρ = 1.724×10⁻⁸ Ω·m). Ampacity is
// the NEC 310.16 copper 75 °C column (a fact table; sizes NEC doesn't list — odd
// small gauges, magnet-wire sizes — output blank rather than a guess).

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
      if (n >= -3 && n <= 40) {
        const d = 0.127 * 92 ** ((36 - n) / 39);
        const a = (Math.PI / 4) * d * d;
        diameter = d;
        area = a;
        resistance = 17.24 / a; // ρ·L/A with ρ_cu = 1.724e-8 Ω·m, per km
        ampacity = Number.isInteger(n) ? AWG_AMPACITY_75C[n] ?? null : null;
      } else {
        const err = solError("#DOMAIN!", "AWG runs 4/0 (enter -3) through 40");
        diameter = area = resistance = err;
      }
    }
    this.cachedDiameter = diameter;
    this.cachedArea = area;
    this.cachedResistance = resistance;
    this.cachedAmpacity = ampacity;
    return { diameter, area, resistance, ampacity };
  }
}
