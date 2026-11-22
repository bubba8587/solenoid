// [[composite-nodes#Packs]], [[C17]] shareImpl

import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { numIn, numOut, strOut, type Quantity } from "./shared";
import { type SolError } from "../errorValue";

export class EmSpectrumNode extends GraphNode {
  label: string;
  literals: Record<string, number> = {};
  cachedBand: string | SolError | null = null;
  cachedFreq: Quantity = null;
  cachedWavelength: Quantity = null;
  unitAware = true;
  width = 220;
  height = 210;

  constructor(init?: { label?: string }) {
    super("EmSpectrum");
    this.label = init?.label ?? "EM Spectrum Band";
    this.addInput("freq", numIn("Frequency Hz"));
    this.addInput("wavelength", numIn("Wavelength m"));
    this.addOutput("band", strOut("Band"));
    this.addOutput("freq", numOut("Frequency"));
    this.addOutput("wavelength", numOut("Wavelength"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { band: string | SolError | null; freq: Quantity; wavelength: Quantity };
  }
}
