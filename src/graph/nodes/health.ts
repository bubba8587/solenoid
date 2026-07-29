// Heart-Rate Zones — the Health & Fitness pack's training-zone table. Age (or a
// wired max HR from the pack's Tanaka node) → a five-zone Frame ready for a
// table popup, a chart, or a lookup. With a resting HR it switches to the
// Karvonen (heart-rate reserve) method; without one, plain %-of-max.

import { ClassicPreset } from "rete";
import { numIn, frameOut, readInput } from "./shared";
import type { FrameValue } from "../frame";
import { solError, type SolError } from "../errorValue";

const ZONES: Array<{ name: string; lo: number; hi: number }> = [
  { name: "Z1 Recovery", lo: 0.5, hi: 0.6 },
  { name: "Z2 Endurance", lo: 0.6, hi: 0.7 },
  { name: "Z3 Tempo", lo: 0.7, hi: 0.8 },
  { name: "Z4 Threshold", lo: 0.8, hi: 0.9 },
  { name: "Z5 Maximum", lo: 0.9, hi: 1 },
];

/** The zone table: %-of-max bands, or Karvonen bands off the heart-rate reserve
 *  when a resting HR is given (rest + pct·(max − rest)). BPM rounded — nobody
 *  trains to a tenth of a beat. */
/** The one domain rule for the zone table (shared by the node and the pack's
 *  HEARTRATEZONES formula): a positive max, and any resting HR strictly
 *  between 0 and it. */
export function hrZonesDomainOk(maxHr: number, restingHr: number | null): boolean {
  return maxHr > 0 && (restingHr === null || (restingHr > 0 && restingHr < maxHr));
}

/** The zone bands as five [low, high] rows (Z1…Z5) — the formula surface's
 *  matrix form of the node's frame (frames stay out of formulas by design;
 *  rank 2 is spellable since D23). Same rounding and Karvonen switch as the
 *  frame. */
export function hrZonesMatrix(maxHr: number, restingHr: number | null): number[][] | SolError {
  if (!hrZonesDomainOk(maxHr, restingHr)) {
    return solError("#DOMAIN!", "Needs max HR > 0 and resting HR below it");
  }
  const f = hrZonesFrame(maxHr, restingHr);
  const lo = f.columns[1].values as number[];
  const hi = f.columns[2].values as number[];
  return lo.map((l, i) => [l, hi[i]]);
}

export function hrZonesFrame(maxHr: number, restingHr: number | null): FrameValue {
  const at = (pct: number) =>
    Math.round(restingHr !== null ? restingHr + pct * (maxHr - restingHr) : pct * maxHr);
  return {
    __frame: true,
    columns: [
      { name: "Zone", type: "string", values: ZONES.map((z) => z.name) },
      { name: "Low", type: "number", values: ZONES.map((z) => at(z.lo)) },
      { name: "High", type: "number", values: ZONES.map((z) => at(z.hi)) },
    ],
  };
}

export class HrZonesNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { age: 30 };
  cachedFrame: FrameValue | SolError | null = null;
  width = 220;
  height = 190;

  constructor(init?: { label?: string }) {
    super("HrZones");
    this.label = init?.label ?? "Heart-Rate Zones";
    this.addInput("age", numIn("Age"));
    // Optional: a resting HR switches the bands to the Karvonen method.
    this.addInput("resting", numIn("Resting HR"));
    // Optional: overrides the classic 220 − age (wire the pack's Tanaka node).
    this.addInput("max", numIn("Max HR"));
    this.addOutput("zones", frameOut("Zones"));
  }

  data(inputs: { age?: (number | null)[]; resting?: (number | null)[]; max?: (number | null)[] }) {
    const age = readInput(inputs.age, this.literals.age ?? null);
    const resting = readInput(inputs.resting, this.literals.resting ?? null);
    const maxIn = readInput(inputs.max, this.literals.max ?? null);
    const maxHr = typeof maxIn === "number" ? maxIn : typeof age === "number" ? 220 - age : null;
    let zones: FrameValue | SolError | null = null;
    if (maxHr !== null) {
      const rest = typeof resting === "number" ? resting : null;
      zones = hrZonesDomainOk(maxHr, rest)
        ? hrZonesFrame(maxHr, rest)
        : solError("#DOMAIN!", "Needs max HR > 0 and resting HR below it");
    }
    this.cachedFrame = zones;
    return { zones };
  }
}
