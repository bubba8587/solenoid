// Triangle Solver — the Geometry pack's task-shaped closer: give any three
// parts (at least one side; angles in degrees) and every remaining side, angle,
// the area, and the perimeter solve.

import { ClassicPreset } from "rete";
import { numListIn, numListOut, logicalComboOut, readInput } from "./shared";
import { isSolError, solError, type SolError } from "../errorValue";
import { clamp } from "./mathUtils";
import type { FormatAnnotation } from "../formatAnnotationStore";

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
  return clamp(x, -1, 1);
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

const PART_KEYS = ["a", "b", "c", "A", "B", "C"] as const;
type PartKey = (typeof PART_KEYS)[number];

/** Relative-tolerance agreement for the over-determined Check (sides and
 *  degrees both live on human scales, so one rule serves). */
function agrees(got: number, given: number): boolean {
  return Math.abs(got - given) <= 1e-6 * Math.max(1, Math.abs(given));
}

/** One triangle's full result: every part's displayed value (given passthrough
 *  or solved), the derived area/perimeter, the Valid check, and which parts were
 *  solved (accent). The pure core both the scalar and the broadcast paths call. */
export interface TriangleResult {
  values: Record<PartKey, number | SolError | null>;
  area: number | SolError | null;
  perimeter: number | SolError | null;
  valid: boolean | SolError | null;
  solved: Set<PartKey>;
}

/** Solve one triangle from a set of given parts (numbers keyed by part; a part
 *  may also arrive as a per-cell SolError, which propagates). Exactly three
 *  parts → solve + Valid TRUE/FALSE; fewer → quiet passthrough; more → solve
 *  from the side-richest subset and Valid = do the extras agree. */
export function solveGivenParts(given: TriangleGiven, cellErr?: SolError): TriangleResult {
  const values = {} as Record<PartKey, number | SolError | null>;
  for (const k of PART_KEYS) values[k] = null;
  const done = (area: number | SolError | null, perimeter: number | SolError | null,
                valid: boolean | SolError | null, solved: Set<PartKey> = new Set()): TriangleResult =>
    ({ values, area, perimeter, valid, solved });

  // An errored given cell (a broadcast index whose input carried #CODE!) → that
  // whole triangle propagates the error, like every element-wise op.
  if (cellErr) {
    for (const k of PART_KEYS) values[k] = cellErr;
    return done(cellErr, cellErr, cellErr);
  }

  const givenKeys = PART_KEYS.filter((k) => given[k] !== undefined);
  for (const k of givenKeys) values[k] = given[k]!;

  if (givenKeys.length < 3) return done(null, null, null); // quiet passthrough

  if (givenKeys.length === 3) {
    const r = solveTriangle(given);
    if (isSolError(r)) {
      for (const k of PART_KEYS) values[k] = r;
      return done(r, r, false);
    }
    for (const k of PART_KEYS) values[k] = r[k];
    return done(r.area, r.perimeter, true, new Set(PART_KEYS.filter((k) => given[k] === undefined)));
  }

  // Over-determined — solve from an independent three-part subset (side-rich
  // first; first that solves wins), then Valid = every REMAINING given agrees.
  const subsets: PartKey[][] = [];
  for (let i = 0; i < givenKeys.length; i++)
    for (let j = i + 1; j < givenKeys.length; j++)
      for (let k = j + 1; k < givenKeys.length; k++)
        subsets.push([givenKeys[i], givenKeys[j], givenKeys[k]]);
  const sideCount = (sub: PartKey[]) => sub.filter((k) => k === k.toLowerCase()).length;
  subsets.sort((x, y) => sideCount(y) - sideCount(x));

  let solvedTri: TriangleSolved | null = null;
  for (const sub of subsets) {
    if (sideCount(sub) === 0) continue;
    const r = solveTriangle(Object.fromEntries(sub.map((k) => [k, given[k]!])));
    if (!isSolError(r)) { solvedTri = r; break; }
  }
  if (!solvedTri) {
    const err = solError("#SOLVE!", "No three of those parts pin down a triangle");
    for (const k of PART_KEYS) values[k] = k in given ? given[k]! : err;
    return done(err, err, false);
  }
  for (const k of PART_KEYS) values[k] = given[k] ?? solvedTri[k];
  const valid = givenKeys.every((k) => agrees(solvedTri![k], given[k]!));
  return done(solvedTri.area, solvedTri.perimeter, valid, new Set(PART_KEYS.filter((k) => given[k] === undefined)));
}

type PartCell = number | SolError | null;
type PartOut = PartCell | PartCell[];

export class TriangleSolverNode extends ClassicPreset.Node {
  label: string;
  /** Per-part displayed value (given passthrough or solved) — a scalar, or a
   *  list when parts are broadcast over parallel lists. */
  cachedValues: Record<string, PartOut> = {};
  cachedArea: PartOut = null;
  cachedPerimeter: PartOut = null;
  cachedValid: boolean | SolError | null | (boolean | SolError | null)[] = null;
  /** Parts SOLVED (accent label), not given — from index 0 when broadcast. */
  solvedKeys: Set<string> = new Set();
  width = 240;
  height = 430;

  /** The angle outputs CARRY degrees the way a Physics Constant carries its
   *  unit — per-output (unitFlow `annotationFor`), the real `deg` FC unit (so the
   *  resolver reads it as an angle, and a trig node in Auto mode picks it up).
   *  A/B/C read as 36.87° wherever they flow; the sides stay unitless. */
  annotationFor(outKey: string): FormatAnnotation | undefined {
    return outKey === "A" || outKey === "B" || outKey === "C"
      ? { format: "auto", unit: "deg" }
      : undefined;
  }

  constructor(init?: { label?: string }) {
    super("TriangleSolver");
    this.label = init?.label ?? "Triangle Solver";
    // The current Equation design: every part is an input AND an output on one
    // hero row, plus the logical Valid check. numlist sockets like the rest of
    // the Equation family, so parallel lists broadcast.
    for (const k of PART_KEYS) {
      this.addInput(k, numListIn(k.toUpperCase() === k ? `${k} \u00b0` : k));
      this.addOutput(k, numListOut(k.toUpperCase() === k ? `${k} \u00b0` : k));
    }
    this.addOutput("area", numListOut("Area"));
    this.addOutput("perimeter", numListOut("Perimeter"));
    this.addOutput("valid", logicalComboOut("Valid"));
  }

  data(inputs: Record<string, (number | number[] | null)[] | undefined>) {
    // Read each part: number | number[] | null (a wired list broadcasts). Parts
    // are known only through their cables — wire-driven like the Equation card.
    const raw = {} as Record<PartKey, number | number[] | null>;
    for (const k of PART_KEYS) raw[k] = readInput(inputs[k], null);
    const listKeys = PART_KEYS.filter((k) => Array.isArray(raw[k]));

    if (listKeys.length === 0) {
      // Scalar path — one triangle.
      const given: TriangleGiven = {};
      for (const k of PART_KEYS) if (typeof raw[k] === "number") given[k] = raw[k] as number;
      const r = solveGivenParts(given);
      this.cachedValues = { ...r.values };
      this.cachedArea = r.area;
      this.cachedPerimeter = r.perimeter;
      this.cachedValid = r.valid;
      this.solvedKeys = r.solved;
      const out: Record<string, PartCell | boolean> = {};
      for (const k of PART_KEYS) out[k] = r.values[k];
      out.area = r.area; out.perimeter = r.perimeter; out.valid = r.valid;
      return out;
    }

    // Broadcast path — a triangle per index. Length = the longest wired list; a
    // scalar part broadcasts to every index, a short list pads with `null` (that
    // part is absent for that index), a per-cell error propagates for that index.
    const len = Math.max(...listKeys.map((k) => (raw[k] as number[]).length));
    const valuesL = {} as Record<PartKey, PartCell[]>;
    for (const k of PART_KEYS) valuesL[k] = [];
    const areaL: PartCell[] = [], periL: PartCell[] = [];
    const validL: (boolean | SolError | null)[] = [];
    let first: TriangleResult | null = null;
    for (let i = 0; i < len; i++) {
      const given: TriangleGiven = {};
      let cellErr: SolError | undefined;
      for (const k of PART_KEYS) {
        const v = raw[k];
        const cell: PartCell = Array.isArray(v) ? (i < v.length ? (v[i] ?? null) : null) : v;
        if (isSolError(cell)) cellErr ??= cell;
        else if (typeof cell === "number") given[k] = cell;
      }
      const r = solveGivenParts(given, cellErr);
      if (i === 0) first = r;
      for (const k of PART_KEYS) valuesL[k].push(r.values[k]);
      areaL.push(r.area); periL.push(r.perimeter); validL.push(r.valid);
    }
    this.cachedValues = { ...valuesL };
    this.cachedArea = areaL;
    this.cachedPerimeter = periL;
    this.cachedValid = validL;
    this.solvedKeys = first?.solved ?? new Set();
    const out: Record<string, PartCell[] | (boolean | SolError | null)[]> = {};
    for (const k of PART_KEYS) out[k] = valuesL[k];
    out.area = areaL; out.perimeter = periL; out.valid = validL;
    return out;
  }
}
