// [[D42]]

import { ClassicPreset } from "rete";
import { numListIn, numListOut, logicalComboOut, readInput } from "./shared";
import { isSolError, solError, type SolError } from "../errorValue";
import { clamp } from "./mathUtils";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { isUnitCell, dimOf } from "../unitValue";
import { displayMagnitudeOf } from "../unitBridge";

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

const PART_KEYS = ["a", "b", "c", "A", "B", "C"] as const;
type PartKey = (typeof PART_KEYS)[number];

function agrees(got: number, given: number): boolean {
  return Math.abs(got - given) <= 1e-6 * Math.max(1, Math.abs(given));
}

export interface TriangleResult {
  values: Record<PartKey, number | SolError | null>;
  area: number | SolError | null;
  perimeter: number | SolError | null;
  valid: boolean | SolError | null;
  solved: Set<PartKey>;
}

export function solveGivenParts(given: TriangleGiven, cellErr?: SolError): TriangleResult {
  const values = {} as Record<PartKey, number | SolError | null>;
  for (const k of PART_KEYS) values[k] = null;
  const done = (area: number | SolError | null, perimeter: number | SolError | null,
                valid: boolean | SolError | null, solved: Set<PartKey> = new Set()): TriangleResult =>
    ({ values, area, perimeter, valid, solved });

  if (cellErr) {
    for (const k of PART_KEYS) values[k] = cellErr;
    return done(cellErr, cellErr, cellErr);
  }

  const givenKeys = PART_KEYS.filter((k) => given[k] !== undefined);
  for (const k of givenKeys) values[k] = given[k]!;

  if (givenKeys.length < 3) return done(null, null, null);

  if (givenKeys.length === 3) {
    const r = solveTriangle(given);
    if (isSolError(r)) {
      for (const k of PART_KEYS) values[k] = r;
      return done(r, r, false);
    }
    for (const k of PART_KEYS) values[k] = r[k];
    return done(r.area, r.perimeter, true, new Set(PART_KEYS.filter((k) => given[k] === undefined)));
  }

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

/** A dimensioned angle holds base radians whatever its display unit, and the solver wants degrees. */
function readPart(k: PartKey, cell: unknown): unknown {
  if (!isUnitCell(cell)) return cell;
  return k === k.toUpperCase() && dimOf(cell).angle === 1 ? cell.value * R2D : displayMagnitudeOf(cell);
}

export class TriangleSolverNode extends ClassicPreset.Node {
  label: string;
  cachedValues: Record<string, PartOut> = {};
  cachedArea: PartOut = null;
  cachedPerimeter: PartOut = null;
  cachedValid: boolean | SolError | null | (boolean | SolError | null)[] = null;
  solvedKeys: Set<string> = new Set();
  width = 240;
  height = 430;

  annotationFor(outKey: string): FormatAnnotation | undefined {
    return outKey === "A" || outKey === "B" || outKey === "C"
      ? { format: "auto", unit: "deg" }
      : undefined;
  }

  constructor(init?: { label?: string }) {
    super("TriangleSolver");
    this.label = init?.label ?? "Triangle Solver";
    for (const k of PART_KEYS) {
      this.addInput(k, numListIn(k.toUpperCase() === k ? `${k} \u00b0` : k));
      this.addOutput(k, numListOut(k.toUpperCase() === k ? `${k} \u00b0` : k));
    }
    this.addOutput("area", numListOut("Area"));
    this.addOutput("perimeter", numListOut("Perimeter"));
    this.addOutput("valid", logicalComboOut("Valid"));
  }

  unitAware = true;

  data(inputs: Record<string, unknown[] | undefined>) {
    const raw = {} as Record<PartKey, number | number[] | null>;
    for (const k of PART_KEYS) {
      const v = readInput(inputs[k], null);
      raw[k] = (Array.isArray(v) ? v.map((c) => readPart(k, c)) : readPart(k, v)) as number | number[] | null;
    }
    const listKeys = PART_KEYS.filter((k) => Array.isArray(raw[k]));

    if (listKeys.length === 0) {
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
