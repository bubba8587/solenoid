// [[C17]] shareImpl

import { solError, type SolError } from "../errorValue";
import { clamp } from "./mathUtils";

export interface TriangleGiven {
  a?: number; b?: number; c?: number; // sides (opposite the same-letter angle)
  A?: number; B?: number; C?: number; // angles, degrees
}
export interface TriangleSolved {
  a: number; b: number; c: number;
  A: number; B: number; C: number;
  area: number; perimeter: number;
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EPS = 1e-9;

export function solveTriangle(g: TriangleGiven): TriangleSolved | SolError {
  const sides = (["a", "b", "c"] as const).filter((k) => g[k] !== undefined);
  const angles = (["A", "B", "C"] as const).filter((k) => g[k] !== undefined);
  if (sides.length + angles.length !== 3) {
    return solError("#SOLVE!", "Give exactly three parts (sides and angles)");
  }
  for (const k of sides) if (!(g[k]! > 0)) return solError("#DOMAIN!", `Side ${k} must be positive`);
  for (const k of angles) if (!(g[k]! > 0 && g[k]! < 180)) return solError("#DOMAIN!", `Angle ${k} must be between 0° and 180°`);
  if (angles.length === 3) return solError("#SOLVE!", "Three angles fix only the shape. Swap one for a side");
  const sumGiven = angles.reduce((s, k) => s + g[k]!, 0);
  if (angles.length >= 2 && sumGiven >= 180 - EPS) return solError("#DOMAIN!", "The angles reach 180° with nothing left over");

  const t: TriangleGiven = { ...g };

  if (sides.length === 3) {
    const { a, b, c } = t as Required<Pick<TriangleGiven, "a" | "b" | "c">>;
    if (a + b <= c + EPS || b + c <= a + EPS || a + c <= b + EPS) {
      return solError("#DOMAIN!", "Those sides break the triangle inequality");
    }
    t.A = Math.acos(clamp1((b * b + c * c - a * a) / (2 * b * c))) * R2D;
    t.B = Math.acos(clamp1((a * a + c * c - b * b) / (2 * a * c))) * R2D;
    t.C = 180 - t.A - t.B;
  } else if (sides.length === 2) {
    const angleKey = angles[0];
    const oppositeSide = angleKey.toLowerCase() as "a" | "b" | "c";
    if (g[oppositeSide] === undefined) {
      const [s1, s2] = sides;
      const missing = oppositeSide;
      t[missing] = Math.sqrt(
        g[s1]! ** 2 + g[s2]! ** 2 - 2 * g[s1]! * g[s2]! * Math.cos(g[angleKey]! * D2R),
      );
      fillBySines(t, missing, angleKey);
    } else {
      const other = sides.find((k) => k !== oppositeSide)!;
      const sinOther = (g[other]! * Math.sin(g[angleKey]! * D2R)) / g[oppositeSide]!;
      if (sinOther > 1 + EPS) return solError("#DOMAIN!", "No triangle fits those parts");
      // Judge the right angle on the sine: asin near 1 loses about 1e-6° to rounding, enough to split one root in two.
      const right = sinOther >= 1 - EPS;
      const deg1 = right ? 90 : Math.asin(clamp1(sinOther)) * R2D;
      const deg2 = 180 - deg1;
      const fits = (d: number) => g[angleKey]! + d < 180 - EPS;
      if (!right && fits(deg1) && fits(deg2)) {
        return solError("#SOLVE!", "Ambiguous (SSA): two triangles fit. Give a different third part");
      }
      const otherAngleKey = other.toUpperCase() as "A" | "B" | "C";
      t[otherAngleKey] = fits(deg1) ? deg1 : deg2;
      const lastAngle = (["A", "B", "C"] as const).find((k) => t[k] === undefined)!;
      t[lastAngle] = 180 - t[angleKey]! - t[otherAngleKey]!;
      const lastSide = lastAngle.toLowerCase() as "a" | "b" | "c";
      t[lastSide] = (g[oppositeSide]! * Math.sin(t[lastAngle]! * D2R)) / Math.sin(g[angleKey]! * D2R);
    }
  } else {
    const lastAngle = (["A", "B", "C"] as const).find((k) => t[k] === undefined)!;
    t[lastAngle] = 180 - sumGiven;
    fillBySines(t, sides[0], sides[0].toUpperCase() as "A" | "B" | "C");
  }

  const r = t as Required<TriangleGiven>;
  const area = 0.5 * r.b * r.c * Math.sin(r.A * D2R);
  return { ...r, area, perimeter: r.a + r.b + r.c };
}

function clamp1(x: number): number {
  return clamp(x, -1, 1);
}

function fillBySines(t: TriangleGiven, knownSide: "a" | "b" | "c", knownAngle: "A" | "B" | "C"): void {
  const angleKeys = ["A", "B", "C"] as const;
  const missingAngles = angleKeys.filter((k) => t[k] === undefined);
  if (missingAngles.length === 1) {
    t[missingAngles[0]] = 180 - angleKeys.reduce((s, k) => s + (t[k] ?? 0), 0);
  } else if (missingAngles.length === 2) {
    const sides = ["a", "b", "c"] as const;
    const [a, b, c] = sides.map((k) => t[k]);
    if (a !== undefined && b !== undefined && c !== undefined) {
      t.A ??= Math.acos(clamp1((b * b + c * c - a * a) / (2 * b * c))) * R2D;
      t.B ??= Math.acos(clamp1((a * a + c * c - b * b) / (2 * a * c))) * R2D;
      t.C = 180 - t.A! - t.B!;
    }
  }
  const ratio = t[knownSide]! / Math.sin(t[knownAngle]! * D2R);
  for (const k of ["a", "b", "c"] as const) {
    if (t[k] === undefined) t[k] = ratio * Math.sin(t[k.toUpperCase() as "A" | "B" | "C"]! * D2R);
  }
}

export const PART_KEYS = ["a", "b", "c", "A", "B", "C"] as const;
export type PartKey = (typeof PART_KEYS)[number];

export interface TriangleResult {
  values: Record<PartKey, number | SolError | null>;
  area: number | SolError | null;
  perimeter: number | SolError | null;
  valid: boolean | SolError | null;
  solved: Set<PartKey>;
}

