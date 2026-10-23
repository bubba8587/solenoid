// [[C17]] shareImpl

// E3–E24 are the published IEC 60063 tables, which deviate from the geometric series; only E48/E96 may be generated.

export type ESeriesOp = "E3" | "E6" | "E12" | "E24" | "E48" | "E96";

export const RESISTOR_DIGIT: Record<string, number> = {
  black: 0, brown: 1, red: 2, orange: 3, yellow: 4,
  green: 5, blue: 6, violet: 7, gray: 8, white: 9,
};
export const RESISTOR_MULT: Record<string, number> = {
  black: 1, brown: 10, red: 100, orange: 1e3, yellow: 1e4,
  green: 1e5, blue: 1e6, violet: 1e7, gray: 1e8, white: 1e9,
  gold: 0.1, silver: 0.01,
};
export const RESISTOR_TOL: Record<string, number> = {
  brown: 1, red: 2, green: 0.5, blue: 0.25, violet: 0.1, gray: 0.05,
  gold: 5, silver: 10,
};

