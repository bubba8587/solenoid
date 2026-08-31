import { ClassicPreset } from "rete";
import { numIn, numOut } from "./shared";

// One-at-a-time sensitivity ranking; the sweep itself lives in tornadoRun.ts.
// Pass-through, so the node can sit inline in a chain.

export interface TornadoResult {
  nodeId: string;
  label: string;
  base: number;
  low: number;
  high: number;
  /** The input values actually swept — the swing is only readable against this width. */
  inputLow: number;
  inputHigh: number;
  /** Perturbation width source — the tornado ranks RAW swing, so this marks the basis
   *  rather than normalizing it away. */
  basis: "slider" | "number";
  /** Non-finite result at an extreme — such a leaf is kept and MARKED, never dropped. */
  diverged: boolean;
}

export class TornadoNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "A run perturbs every Number and Slider upstream of this input and ranks them by how far this value swings.",
  };

  label: string;
  cachedResult: number | null = null;
  /** Last completed run's ranking, best (biggest swing) first. Null = never run. */
  results: TornadoResult[] | null = null;
  // Must track the --wide card and TORNADO_W, or ELK reserves the wrong footprint.
  width = 240;
  height = 280;

  constructor(init?: { label?: string }) {
    super("Tornado");
    this.label = init?.label ?? "Tornado";
    this.addInput("value", numIn("Value"));
    this.addOutput("out", numOut("Pass-through"));
  }

  data(inputs: { value?: number[] }) {
    const v = inputs.value?.[0] ?? null;
    this.cachedResult = v;
    return { out: v };
  }
}
