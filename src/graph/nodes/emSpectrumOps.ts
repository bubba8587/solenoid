// [[C17]] shareImpl

import { solError, type SolError } from "../errorValue";

const C = 299792458; // m/s

/** Takes a wavelength in meters. Textbook boundaries, not ISO 21348's (which puts visible at 380–760 nm and X-ray down to 0.001 nm). */
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

/** Frequency wins when both are given; null means no usable input, and a non-positive or non-finite frequency or wavelength is #DOMAIN!. */
export function emSpectrum(f: number | null, wl: number | null): { band: string; freq: number; wavelength: number } | SolError | null {
  const fq = typeof f === "number" ? f : typeof wl === "number" ? (wl > 0 ? C / wl : NaN) : null;
  if (fq === null) return null;
  if (!(fq > 0) || !Number.isFinite(fq)) {
    return solError("#DOMAIN!", "Needs a positive frequency or wavelength");
  }
  const lambda = C / fq;
  return { band: emBand(lambda), freq: fq, wavelength: lambda };
}
