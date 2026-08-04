// Classifier half of the Electromagnetism pack — the Wavelength ↔ Frequency
// equation node does the conversion.

import { ClassicPreset } from "rete";
import { numIn, numOut, strOut, readInput } from "./shared";
import { solError, isSolError, type SolError } from "../errorValue";

const C = 299792458; // m/s

/** Wavelength in METERS; boundaries are the conventional ISO 21348-adjacent ones. */
export function emBand(wavelengthM: number): string {
  const nm = wavelengthM * 1e9;
  if (wavelengthM >= 1) return "Radio";
  if (wavelengthM >= 1e-3) return "Microwave";
  if (nm >= 750) return "Infrared";
  if (nm >= 380) {
    if (nm >= 620) return "Visible (red)";
    if (nm >= 590) return "Visible (orange)";
    if (nm >= 570) return "Visible (yellow)";
    if (nm >= 495) return "Visible (green)";
    if (nm >= 450) return "Visible (blue)";
    return "Visible (violet)";
  }
  if (nm >= 10) return "Ultraviolet";
  if (nm >= 0.01) return "X-ray";
  return "Gamma";
}

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
    // Give either one; a wired/typed frequency wins when both are present.
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

/** Frequency WINS when both are given; null = no usable input, #DOMAIN! for a
 *  non-positive or non-finite frequency. Shared with the EMSPECTRUMBAND formula. */
export function emSpectrum(f: number | null, wl: number | null): { band: string; freq: number; wavelength: number } | SolError | null {
  const fq = typeof f === "number" ? f : typeof wl === "number" && wl > 0 ? C / wl : null;
  if (fq === null) return null;
  if (!(fq > 0) || !Number.isFinite(fq)) {
    return solError("#DOMAIN!", "Needs a positive frequency or wavelength");
  }
  const lambda = C / fq;
  return { band: emBand(lambda), freq: fq, wavelength: lambda };
}
