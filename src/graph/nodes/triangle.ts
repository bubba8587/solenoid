// Triangle Solver — the Geometry pack's task-shaped closer: give any three
// parts (at least one side; angles in degrees) and every remaining side, angle,
// the area, and the perimeter solve. The Equation-node spirit applied to the
// one shape every geometry problem keeps coming back to — no picking the right
// law-of-sines/cosines preset, no mode dropdown.

import { ClassicPreset } from "rete";
import { numIn, numOut, readInput } from "./shared";
import { solError, type SolError } from "../errorValue";

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

/** Solve from exactly three given parts, at least one a side. SSS / SAS / SSA /
 *  ASA / AAS all route through here; the genuinely ambiguous SSA case (two
 *  triangles fit) is an error rather than a silent pick. */
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
    // SSS — law of cosines, largest angle last so rounding can't push acos out of range.
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
      // SAS — the angle sits between the two given sides: its opposite side is the gap.
      const [s1, s2] = sides;
      const missing = oppositeSide;
      t[missing] = Math.sqrt(
        g[s1]! ** 2 + g[s2]! ** 2 - 2 * g[s1]! * g[s2]! * Math.cos(g[angleKey]! * D2R),
      );
      fillBySines(t, missing, angleKey);
    } else {
      // SSA — the angle is opposite one GIVEN side: law of sines, watch the ambiguity.
      const other = sides.find((k) => k !== oppositeSide)!;
      const sinOther = (g[other]! * Math.sin(g[angleKey]! * D2R)) / g[oppositeSide]!;
      if (sinOther > 1 + EPS) return solError("#DOMAIN!", "No triangle fits those parts");
      const deg1 = Math.asin(clamp1(sinOther)) * R2D;
      const deg2 = 180 - deg1;
      const fits = (d: number) => g[angleKey]! + d < 180 - EPS;
      if (fits(deg1) && fits(deg2) && Math.abs(deg1 - deg2) > 1e-6) {
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
    // ASA / AAS — two angles + one side: the third angle is forced, sines do the rest.
    const lastAngle = (["A", "B", "C"] as const).find((k) => t[k] === undefined)!;
    t[lastAngle] = 180 - sumGiven;
    fillBySines(t, sides[0], sides[0].toUpperCase() as "A" | "B" | "C");
  }

  const r = t as Required<TriangleGiven>;
  const area = 0.5 * r.b * r.c * Math.sin(r.A * D2R);
  return { ...r, area, perimeter: r.a + r.b + r.c };
}

function clamp1(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

/** With every angle known (or derivable) and one side/angle pair complete, fill
 *  the remaining sides and angles via the law of sines. */
function fillBySines(t: TriangleGiven, knownSide: "a" | "b" | "c", knownAngle: "A" | "B" | "C"): void {
  // Complete the angles first (two known → the third is forced).
  const angleKeys = ["A", "B", "C"] as const;
  const missingAngles = angleKeys.filter((k) => t[k] === undefined);
  if (missingAngles.length === 1) {
    t[missingAngles[0]] = 180 - angleKeys.reduce((s, k) => s + (t[k] ?? 0), 0);
  } else if (missingAngles.length === 2) {
    // SAS lands here: two sides + all three angles derivable from cosine law is
    // overkill — use cosine law once more for a second angle off the known parts.
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

export class TriangleSolverNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = {};
  cached: Partial<TriangleSolved> | null = null;
  cachedError: SolError | null = null;
  width = 230;
  height = 330;

  constructor(init?: { label?: string }) {
    super("TriangleSolver");
    this.label = init?.label ?? "Triangle Solver";
    this.addInput("a", numIn("a"));
    this.addInput("b", numIn("b"));
    this.addInput("c", numIn("c"));
    this.addInput("A", numIn("A °"));
    this.addInput("B", numIn("B °"));
    this.addInput("C", numIn("C °"));
    this.addOutput("a", numOut("a"));
    this.addOutput("b", numOut("b"));
    this.addOutput("c", numOut("c"));
    this.addOutput("A", numOut("A °"));
    this.addOutput("B", numOut("B °"));
    this.addOutput("C", numOut("C °"));
    this.addOutput("area", numOut("Area"));
    this.addOutput("perimeter", numOut("Perimeter"));
  }

  data(inputs: Record<string, (number | null)[] | undefined>) {
    const given: TriangleGiven = {};
    for (const k of ["a", "b", "c", "A", "B", "C"] as const) {
      const v = readInput(inputs[k], this.literals[k] ?? null);
      if (typeof v === "number") given[k] = v;
    }
    const count = Object.keys(given).length;
    if (count === 0) {
      this.cached = null;
      this.cachedError = null;
      return { a: null, b: null, c: null, A: null, B: null, C: null, area: null, perimeter: null };
    }
    const r = solveTriangle(given);
    if ("code" in (r as object)) {
      const err = r as SolError;
      this.cached = null;
      this.cachedError = err;
      return { a: err, b: err, c: err, A: err, B: err, C: err, area: err, perimeter: err };
    }
    const t = r as TriangleSolved;
    this.cached = t;
    this.cachedError = null;
    return { ...t };
  }
}
