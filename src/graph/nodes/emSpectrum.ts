// [[C76]] formulaPackDefault, [[C17]] shareImpl

import { ClassicPreset } from "rete";
import { numIn, numOut, strOut, readInput } from "./shared";
import { isSolError, type SolError } from "../errorValue";
import { emSpectrum } from "./emSpectrumOps";

export class EmSpectrumNode extends ClassicPreset.Node {
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

  data(inputs: { freq?: (number | null)[]; wavelength?: (number | null)[] }) {
    const f = readInput(inputs.freq, this.literals.freq ?? null);
    const wl = readInput(inputs.wavelength, this.literals.wavelength ?? null);
    const finish = (band: string | SolError | null, freq: number | SolError | null, wavelength: number | SolError | null) => {
      this.cachedBand = band;
      this.cachedFreq = freq;
      this.cachedWavelength = wavelength;
      return { band, freq, wavelength };
    };
    const r = emSpectrum(typeof f === "number" ? f : null, typeof wl === "number" ? wl : null);
    if (r === null) return finish(null, null, null);
    if (isSolError(r)) return finish(r, r, r);
    return finish(r.band, r.freq, r.wavelength);
  }
}
