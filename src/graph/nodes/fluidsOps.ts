// [[D19]] implReteFree, [[C17]] shareImpl

import { solError, type SolError } from "../errorValue";

/** Fixed-point iteration on x = 1/√f, a contraction for every physical Re and ε/D given the Swamee–Jain seed. */
export function colebrookF(re: number, rr: number): number {
  let x = 1 / Math.sqrt(0.25 / Math.log10(rr / 3.7 + 5.74 / re ** 0.9) ** 2);
  for (let i = 0; i < 100; i++) {
    const next = -2 * Math.log10(rr / 3.7 + (2.51 * x) / re);
    if (Math.abs(next - x) < 1e-13) { x = next; break; }
    x = next;
  }
  return 1 / (x * x);
}

export function colebrookFriction(re: number, rr: number): number | SolError {
  if (re <= 0 || rr < 0 || rr >= 1) {
    return solError("#DOMAIN!", "Needs Re > 0 and relative roughness 0 ≤ ε/D < 1");
  }
  return re < 2300 ? 64 / re : colebrookF(re, rr);
}

// Absolute roughness ε in mm.

export const PIPE_ROUGHNESS: Array<{ id: string; label: string; mm: number }> = [
  { id: "pvc",        label: "PVC / plastic / drawn tubing", mm: 0.0015 },
  { id: "copper",     label: "Copper / brass (drawn)",       mm: 0.0015 },
  { id: "stainless",  label: "Stainless steel",              mm: 0.015 },
  { id: "steel",      label: "Commercial steel",             mm: 0.045 },
  { id: "wrought",    label: "Wrought iron",                 mm: 0.046 },
  { id: "asphalted",  label: "Asphalted cast iron",          mm: 0.12 },
  { id: "galvanized", label: "Galvanized iron",              mm: 0.15 },
  { id: "castiron",   label: "Cast iron",                    mm: 0.26 },
  { id: "concrete",   label: "Concrete (smooth)",            mm: 0.3 },
  { id: "wood",       label: "Wood stave",                   mm: 0.5 },
  { id: "concreteR",  label: "Concrete (rough)",             mm: 3 },
  { id: "riveted",    label: "Riveted steel",                mm: 3 },
  { id: "corrugated", label: "Corrugated metal",             mm: 45 },
];
