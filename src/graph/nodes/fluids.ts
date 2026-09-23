// [[C76]] formulaPackDefault

import { ClassicPreset } from "rete";
import { numIn, numOut, readInput } from "./shared";
import { solError, type SolError } from "../errorValue";
import { colebrookFriction, PIPE_ROUGHNESS } from "./fluidsOps";

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

const ROUGHNESS_BY_ID = new Map(PIPE_ROUGHNESS.map((r) => [r.id, r]));

export class PipeRoughnessNode extends ClassicPreset.Node {
  label: string;
  material: string;
  literals: Record<string, number> = {};
  cachedEps: number | null = null;
  cachedRel: number | SolError | null = null;
  width = 220;
  height = 190;

  constructor(init?: { label?: string; material?: string }) {
    super("PipeRoughness");
    this.label = init?.label ?? "Pipe Roughness";
    this.material = init?.material && ROUGHNESS_BY_ID.has(init.material) ? init.material : "steel";
    this.addInput("d", numIn("Diameter mm"));
    this.addOutput("eps", numOut("ε mm"));
    this.addOutput("rel", numOut("ε/D"));
  }

  data(inputs: { d?: (number | null)[] }) {
    const eps = ROUGHNESS_BY_ID.get(this.material)!.mm;
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
