// [[D19]] implReteFree, [[C17]] shareImpl

import { solError, type SolError } from "../errorValue";
import { forAggregate } from "../valueKinds";

/** A 0 element must short-circuit to 0 here: computing through 1/0 = ∞ would trip the finite guard. */
export function parallelCombine(cells: readonly (number | null | SolError)[]): number | SolError | null {
  const prep = forAggregate([...cells]);
  if (prep.error) return prep.error;
  const arr = prep.nums;
  if (arr.length === 0) return null;
  if (arr.some((v) => v === 0)) return 0;
  const sum = arr.reduce((a, b) => a + 1 / b, 0);
  return sum === 0
    ? solError("#DIV/0!", "The reciprocals cancel out, so the combination is undefined")
    : 1 / sum;
}

// E3–E24 are the published IEC 60063 tables, which deviate from the geometric series; only E48/E96 may be generated.

export type ESeriesOp = "E3" | "E6" | "E12" | "E24" | "E48" | "E96";

const E24_TABLE = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
  3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
];

function generated(n: 48 | 96): number[] {
  return Array.from({ length: n }, (_, k) => Number((10 ** (k / n)).toPrecision(3)));
}

export const E_SERIES: Record<ESeriesOp, number[]> = {
  E3:  [1.0, 2.2, 4.7],
  E6:  [1.0, 1.5, 2.2, 3.3, 4.7, 6.8],
  E12: E24_TABLE.filter((_, i) => i % 2 === 0),
  E24: E24_TABLE,
  E48: generated(48),
  E96: generated(96),
};

export function nearestESeries(value: number, series: ESeriesOp): number {
  const decade = Math.floor(Math.log10(value));
  let best = NaN;
  let bestDist = Infinity;
  for (const d of [decade - 1, decade, decade + 1]) {
    for (const m of E_SERIES[series]) {
      const cand = m * 10 ** d;
      const dist = Math.abs(Math.log(value / cand));
      if (dist < bestDist) { bestDist = dist; best = cand; }
    }
  }
  // Round away float dust: 4.7 * 10^3 is 4700.000000000001.
  return Number(best.toPrecision(12));
}

const AWG_AMPACITY_75C: Record<number, number> = {
  [-3]: 230, [-2]: 200, [-1]: 175, 0: 150, 1: 130, 2: 115, 3: 100,
  4: 85, 6: 65, 8: 50, 10: 35, 12: 25, 14: 20,
};

/** Diameter in mm, area in mm², resistance in Ω/km (ρ_cu = 1.724e-8 Ω·m). */
export function awgWire(n: number): { diameter: number; area: number; resistance: number; ampacity: number | null } | SolError {
  if (!(n >= -3 && n <= 40)) return solError("#DOMAIN!", "AWG runs 4/0 (enter -3) through 40");
  const d = 0.127 * 92 ** ((36 - n) / 39);
  const a = (Math.PI / 4) * d * d;
  return { diameter: d, area: a, resistance: 17.24 / a, ampacity: Number.isInteger(n) ? AWG_AMPACITY_75C[n] ?? null : null };
}

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

export function decodeResistor(
  d1: string, d2: string, d3: string, mult: string, tol: string, five: boolean,
): { ohms: number; tolerance: number } | SolError {
  const digits = five ? [d1, d2, d3] : [d1, d2];
  let value = 0;
  for (const d of digits) {
    const v = RESISTOR_DIGIT[d];
    if (v === undefined) return solError("#VALUE!", `"${d}" is not a digit band color`);
    value = value * 10 + v;
  }
  const m = RESISTOR_MULT[mult];
  if (m === undefined) return solError("#VALUE!", `"${mult}" is not a multiplier band color`);
  const t = RESISTOR_TOL[tol];
  if (t === undefined) return solError("#VALUE!", `"${tol}" is not a tolerance band color`);
  return { ohms: value * m, tolerance: t };
}
