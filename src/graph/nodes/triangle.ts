// [[D42]], [[C25]] firstClassUnits

import { ClassicPreset } from "rete";
import { numListIn, numListOut, logicalComboOut, readInput } from "./shared";
import { isSolError, type SolError } from "../errorValue";
import { R2D, PART_KEYS, solveGivenParts, type PartKey, type TriangleGiven, type TriangleResult } from "./triangleOps";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { isUnitCell, tagDim, unitError, fromUnit, type UnitCell } from "../unitValue";
import { fcUnitToUnit } from "../unitBridge";
import { type Unit, dimEqual, dimPow, isDimensionless } from "../dimension";

type PartCell = number | SolError | null;
type PartOut = PartCell | UnitCell | (PartCell | UnitCell)[];

const isAngleKey = (k: PartKey) => k === k.toUpperCase();

interface SideUnit { unit: Unit; id?: string }

/** The one unit the sides solve in: the first united side's display unit, else its base unit.
 *  A bare side reads in it. Sides of two dimensions, a side on an offset scale, or an angle
 *  input that isn't an angle are #UNIT!. */
function sideUnit(inputs: Record<string, unknown>): SideUnit | SolError | null {
  let found: SideUnit | null = null;
  for (const k of PART_KEYS) {
    const v = inputs[k];
    for (const c of Array.isArray(v) ? v : [v]) {
      if (!isUnitCell(c) || isDimensionless(c.dim)) continue;
      if (isAngleKey(k)) {
        if (!dimEqual(c.dim, { angle: 1 })) return unitError(`${k} is an angle.`);
        continue;
      }
      if (found && !dimEqual(found.unit.dim, c.dim)) return unitError("The three sides must share one dimension.");
      if (found) continue;
      const u = c.display ? fcUnitToUnit(c.display) : null;
      if (u?.offset) return unitError("A side can't be on an offset scale.");
      found = u && dimEqual(u.dim, c.dim) ? { unit: u, id: c.display } : { unit: { dim: c.dim, scale: 1 } };
    }
  }
  return found;
}

/** A dimensioned angle holds base radians whatever its display unit, and the solver wants degrees. */
function readPart(k: PartKey, cell: unknown, su: SideUnit | null): unknown {
  if (!isUnitCell(cell)) return cell;
  if (isDimensionless(cell.dim)) return cell.value;
  if (isAngleKey(k)) return cell.value * R2D;
  return su ? cell.value / su.unit.scale : cell.value;
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
    const read: Record<string, unknown> = {};
    for (const k of PART_KEYS) read[k] = readInput(inputs[k], null);
    const su = sideUnit(read);
    if (isSolError(su)) return this.fail(su);
    const raw = {} as Record<PartKey, number | number[] | null>;
    for (const k of PART_KEYS) {
      const v = read[k];
      raw[k] = (Array.isArray(v) ? v.map((c) => readPart(k, c, su)) : readPart(k, v, su)) as number | number[] | null;
    }
    const out = this.solve(raw);
    return su ? this.tagSides(out, su) : out;
  }

  private fail(err: SolError): Record<string, SolError> {
    const out: Record<string, SolError> = {};
    for (const k of PART_KEYS) out[k] = err;
    out.area = err; out.perimeter = err; out.valid = err;
    this.cachedValues = { ...out };
    this.cachedArea = err; this.cachedPerimeter = err; this.cachedValid = err;
    this.solvedKeys = new Set();
    return out;
  }

  /** Sides and perimeter come back in the sides' unit, the area in its square. */
  private tagSides(out: Record<string, unknown>, su: SideUnit): Record<string, unknown> {
    const { unit, id } = su;
    const sq = id ? fcUnitToUnit(`${id}2`) : null;
    const areaId = sq && dimEqual(sq.dim, dimPow(unit.dim, 2)) ? `${id}2` : undefined;
    const side = (n: unknown) => (typeof n === "number" ? fromUnit(n, unit, id) : n);
    const area = (n: unknown) => (typeof n === "number" ? tagDim(n * unit.scale ** 2, dimPow(unit.dim, 2), areaId) : n);
    const each = (v: unknown, f: (n: unknown) => unknown) => (Array.isArray(v) ? v.map(f) : f(v));
    const tagged: Record<string, unknown> = { ...out };
    for (const k of ["a", "b", "c", "perimeter"]) tagged[k] = each(out[k], side);
    tagged.area = each(out.area, area);
    this.cachedValues = { ...this.cachedValues, a: tagged.a as PartOut, b: tagged.b as PartOut, c: tagged.c as PartOut };
    this.cachedArea = tagged.area as PartOut;
    this.cachedPerimeter = tagged.perimeter as PartOut;
    return tagged;
  }

  private solve(raw: Record<PartKey, number | number[] | null>): Record<string, unknown> {
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
