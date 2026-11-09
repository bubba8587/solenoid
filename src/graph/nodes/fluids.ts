// [[C76]] formulaPackDefault

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, numOut, numListIn, numListOut } from "./shared";
import { type SolError } from "../errorValue";
import { PIPE_ROUGHNESS } from "./fluidsOps";

export class ColebrookNode extends GraphNode {
  label: string;
  literals: Record<string, number> = {};
  cachedResult: number | SolError | null | (number | SolError | null)[] = null;
  width = 200;
  height = 170;

  constructor(init?: { label?: string }) {
    super("Colebrook");
    this.label = init?.label ?? "Friction Factor (Colebrook)";
    // Element-wise, as COLEBROOK is: a list of Reynolds numbers answers a friction factor each.
    this.addInput("re", numListIn("Re"));
    this.addInput("rr", numListIn("ε/D"));
    this.addOutput("result", numListOut("f"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | SolError | null | (number | SolError | null)[] };
  }
}

const ROUGHNESS_BY_ID = new Map(PIPE_ROUGHNESS.map((r) => [r.id, r]));

export class PipeRoughnessNode extends GraphNode {
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
