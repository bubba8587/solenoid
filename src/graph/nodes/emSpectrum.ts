// [[C76]] formulaPackDefault, [[C17]] shareImpl

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, numOut, strOut } from "./shared";
import { type SolError } from "../errorValue";

export class EmSpectrumNode extends GraphNode {
  label: string;
  literals: Record<string, number> = { freq: 5e14 };
  cachedBand: string | SolError | null = null;
  cachedFreq: number | SolError | null = null;
  cachedWavelength: number | SolError | null = null;
  width = 220;
  height = 210;

  constructor(init?: { label?: string }) {
    super("EmSpectrum");
    this.label = init?.label ?? "EM Spectrum Band";
    this.addInput("freq", numIn("Frequency Hz"));
    this.addInput("wavelength", numIn("Wavelength m"));
    this.addOutput("band", strOut("Band"));
    this.addOutput("freq", numOut("Hz"));
    this.addOutput("wavelength", numOut("m"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { band: string | SolError | null; freq: number | SolError | null; wavelength: number | SolError | null };
  }
}
