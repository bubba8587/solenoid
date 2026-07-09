// Custom-logic node for the Fluid Mechanics pack: the Colebrook–White friction
// factor is IMPLICIT (1/√f appears on both sides), so it root-finds — the
// declared pack exception the Expression compiler can't cover
// (docs/pack-architecture.md, docs/archive/reference-packs.md "solver" note).

import { ClassicPreset } from "rete";
import { numIn, numOut, readInput } from "./shared";
import { solError, type SolError } from "../errorValue";

/** Solve 1/√f = −2·log₁₀(rr/3.7 + 2.51/(Re·√f)) by fixed-point iteration on
 *  x = 1/√f (contraction for every physical Re/rr; converges in a handful of
 *  steps from the Swamee–Jain seed). Exported for tests. */
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
    let result: number | SolError | null = null;
    if (typeof re === "number" && typeof rr === "number") {
      if (re <= 0 || rr < 0 || rr >= 1) {
        result = solError("#DOMAIN!", "Needs Re > 0 and relative roughness 0 ≤ ε/D < 1");
      } else if (re < 2300) {
        result = 64 / re; // laminar — Colebrook doesn't apply, hand off to 64/Re
      } else {
        result = colebrookF(re, rr);
      }
    }
    this.cachedResult = result;
    return { result };
  }
}
