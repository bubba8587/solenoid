// [[C10]] socketLattice, [[C17]] shareImpl
// Keep this import type-only, so no runtime cycle with errorValue can form.
import type { SolError } from "../errorValue";
import { matRows, matCols } from "./matrixOps";

export type Mat = number[][];

/** The guard matches this by `name`, so never rename it. */
export class ShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShapeError";
  }
}

// A non-array is a scalar whatever its type, never a list of characters.
type Numeric = number | number[] | Mat;

function is2D(v: number[] | Mat): v is Mat {
  return v.length > 0 && Array.isArray(v[0]);
}

export function toMatrix(v: Numeric | null | undefined): Mat | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return [[v]];
  if (v.length === 0) return [];
  return is2D(v) ? v : [v as number[]];
}

export function toList(v: Numeric | null | undefined): number[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return [v];
  if (v.length === 0) return [];
  if (!is2D(v)) return v as number[];
  const m = v as Mat;
  if (m.length === 1) return [...m[0]];
  if (m.every((r) => r.length === 1)) return m.map((r) => r[0]);
  throw new ShapeError(`Expected a list, got a ${m.length}×${m[0]?.length ?? 0} table`);
}

export function toScalar(v: Numeric | null | undefined): number | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return v;
  const flat = is2D(v) ? (v as Mat).flat() : (v as number[]);
  if (flat.length === 1) return flat[0];
  throw new ShapeError(`Expected a single value, got ${flat.length}`);
}

export type Cell = number | string | boolean | SolError | null;

export function toAnyMatrix(v: unknown): Cell[][] | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    return (Array.isArray(v[0]) ? v : [v]) as Cell[][];
  }
  return [[v as Cell]];
}

export function matrixShape(v: unknown): { rows: number | null; cols: number | null } {
  const m = toAnyMatrix(v);
  return { rows: m ? matRows(m) : null, cols: m ? matCols(m) : null };
}
