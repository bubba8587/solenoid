import type { Pack } from "./packShared";

// Re-homes the scipy-shaped toolkit out of the base Add menu: signal processing and
// numerical methods that a spreadsheet user never reaches for. Tags only — every node
// stays registered and saved graphs load with the pack off.
export const SCIENTIFIC_PACK: Pack = {
  id: "scientific",
  name: "Scientific Computing",
  description: "Signal processing and numerical methods: FFT spectrum, smoothing, peak finding, convolution, ODE integration, linear-system solve, eigenvalues, polynomial roots, distribution fitting, and seasonal decomposition.",
  builtin: true,
  defaultActive: false,
  group: "Analysis",
  tags: [
    "list-spectrum", "list-smooth", "list-peaks", "list-convolve",
    "ode-integrate", "mat-solve", "mat-eigen", "cx-polyroots",
    "fit-distribution", "decompose",
  ],
};
