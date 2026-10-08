// [[C17]] shareImpl, [[C15]] matricesInFormulas

import { solError, type SolError } from "../errorValue";

export const ZONES: Array<{ name: string; lo: number; hi: number }> = [
  { name: "Z1 Recovery", lo: 0.5, hi: 0.6 },
  { name: "Z2 Endurance", lo: 0.6, hi: 0.7 },
  { name: "Z3 Tempo", lo: 0.7, hi: 0.8 },
  { name: "Z4 Threshold", lo: 0.8, hi: 0.9 },
  { name: "Z5 Maximum", lo: 0.9, hi: 1 },
];

export function hrZonesDomainOk(maxHr: number, restingHr: number | null): boolean {
  return maxHr > 0 && (restingHr === null || (restingHr > 0 && restingHr < maxHr));
}

export function hrZoneBounds(maxHr: number, restingHr: number | null): number[][] {
  const at = (pct: number) =>
    Math.round(restingHr !== null ? restingHr + pct * (maxHr - restingHr) : pct * maxHr);
  return ZONES.map((z) => [at(z.lo), at(z.hi)]);
}

export function hrZonesMatrix(maxHr: number, restingHr: number | null): number[][] | SolError {
  if (!hrZonesDomainOk(maxHr, restingHr)) {
    return solError("#DOMAIN!", "Needs max HR > 0 and resting HR below it");
  }
  return hrZoneBounds(maxHr, restingHr);
}
