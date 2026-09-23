import { ClassicPreset } from "rete";
import { numIn, numOut } from "./shared";

export interface TornadoResult {
  nodeId: string;
  label: string;
  base: number;
  low: number;
  high: number;
  inputLow: number;
  inputHigh: number;
  basis: "slider" | "number";
  diverged: boolean;
}

export class TornadoNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "A run perturbs every Number and Slider upstream of this input and ranks them by how far this value swings.",
  };

  label: string;
  cachedResult: number | null = null;
  results: TornadoResult[] | null = null;
  // Must match the --wide card and TORNADO_W, or ELK reserves the wrong footprint.
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
