// [[D42]]

import { ClassicPreset } from "rete";
import { numListIn, numListOut, logicalComboOut, readInput } from "./shared";
import { isSolError, type SolError } from "../errorValue";
import { R2D, PART_KEYS, solveGivenParts, type PartKey, type TriangleGiven, type TriangleResult } from "./triangleOps";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { isUnitCell, dimOf } from "../unitValue";
import { displayMagnitudeOf } from "../unitBridge";

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
