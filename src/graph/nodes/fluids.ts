// [[C76]] formulaPackDefault

import { ClassicPreset } from "rete";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, numOut } from "./shared";
import { type SolError } from "../errorValue";
import { PIPE_ROUGHNESS } from "./fluidsOps";

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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | SolError | null };
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { eps: number; rel: number | SolError | null };
  }
}
