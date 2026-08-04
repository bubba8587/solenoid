// The declared Fluid Mechanics pack exception (docs/pack-architecture.md): the
// Colebrook–White factor is implicit, so it root-finds where a formula can't.

import { ClassicPreset } from "rete";
import { numIn, numOut, readInput } from "./shared";
import { solError, type SolError } from "../errorValue";

/** Solve 1/√f = −2·log₁₀(rr/3.7 + 2.51/(Re·√f)) by fixed-point iteration on x = 1/√f
 *  — a contraction for every physical Re/rr, given the Swamee–Jain seed. */
export function colebrookF(re: number, rr: number): number {
  // Swamee–Jain explicit approximation as the seed.
  let x = 1 / Math.sqrt(0.25 / Math.log10(rr / 3.7 + 5.74 / re ** 0.9) ** 2);
  for (let i = 0; i < 100; i++) {
    const next = -2 * Math.log10(rr / 3.7 + (2.51 * x) / re);
    if (Math.abs(next - x) < 1e-13) { x = next; break; }
    x = next;
  }
  return 1 / (x * x);
}

export class ColebrookNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { re: 100000, rr: 0.0001 };
  cachedResult: number | SolError | null = null;
  width = 200;
  height = 170;

  constructor(init?: { label?: string }) {
    super("Colebrook");
    this.label = init?.label ?? "Friction Factor (Colebrook)";
    this.addInput("re", numIn("Re"));
    this.addInput("rr", numIn("ε/D"));
    this.addOutput("result", numOut("f"));
  }

  data(inputs: { re?: (number | null)[]; rr?: (number | null)[] }) {
    const re = readInput(inputs.re, this.literals.re);
    const rr = readInput(inputs.rr, this.literals.rr);
    const result = typeof re === "number" && typeof rr === "number" ? colebrookFriction(re, rr) : null;
    this.cachedResult = result;
    return { result };
  }
}

/** The guarded friction factor the node and the pack's COLEBROOK formula share:
 *  #DOMAIN! outside Re > 0 / 0 ≤ ε/D < 1, the laminar 64/Re hand-off below
 *  Re 2300, Colebrook–White above. */
export function colebrookFriction(re: number, rr: number): number | SolError {
  if (re <= 0 || rr < 0 || rr >= 1) {
    return solError("#DOMAIN!", "Needs Re > 0 and relative roughness 0 ≤ ε/D < 1");
  }
  return re < 2300 ? 64 / re : colebrookF(re, rr);
}

// Absolute roughness ε in mm, textbook engineering values.

export const PIPE_ROUGHNESS: Array<{ id: string; label: string; mm: number }> = [
  { id: "pvc",        label: "PVC / plastic / drawn tubing", mm: 0.0015 },
  { id: "copper",     label: "Copper / brass (drawn)",       mm: 0.0015 },
  { id: "stainless",  label: "Stainless steel",              mm: 0.015 },
  { id: "steel",      label: "Commercial steel",             mm: 0.045 },
  { id: "wrought",    label: "Wrought iron",                 mm: 0.046 },
  { id: "asphalted",  label: "Asphalted cast iron",          mm: 0.12 },
  { id: "galvanized", label: "Galvanized iron",              mm: 0.15 },
  { id: "castiron",   label: "Cast iron",                    mm: 0.26 },
  { id: "concrete",   label: "Concrete (smooth)",            mm: 0.3 },
  { id: "wood",       label: "Wood stave",                   mm: 0.5 },
  { id: "concreteR",  label: "Concrete (rough)",             mm: 3 },
  { id: "riveted",    label: "Riveted steel",                mm: 3 },
  { id: "corrugated", label: "Corrugated metal",             mm: 45 },
];
const ROUGHNESS_BY_ID = new Map(PIPE_ROUGHNESS.map((r) => [r.id, r]));

export class PipeRoughnessNode extends ClassicPreset.Node {
  label: string;
  op: string; // material id
  literals: Record<string, number> = {};
  cachedEps: number | null = null;
  cachedRel: number | SolError | null = null;
  width = 220;
  height = 190;

  constructor(init?: { label?: string; op?: string }) {
    super("PipeRoughness");
    this.label = init?.label ?? "Pipe Roughness";
    this.op = init?.op && ROUGHNESS_BY_ID.has(init.op) ? init.op : "steel";
    this.addInput("d", numIn("Diameter mm"));
    this.addOutput("eps", numOut("ε mm"));
    this.addOutput("rel", numOut("ε/D"));
  }

  data(inputs: { d?: (number | null)[] }) {
    const eps = ROUGHNESS_BY_ID.get(this.op)!.mm;
    const d = readInput(inputs.d, this.literals.d ?? null);
    let rel: number | SolError | null = null;
    if (typeof d === "number") {
      rel = d > 0 ? eps / d : solError("#DOMAIN!", "Diameter must be positive");
    }
    this.cachedEps = eps;
    this.cachedRel = rel;
    return { eps, rel };
  }
}
