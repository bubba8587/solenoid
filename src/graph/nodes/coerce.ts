// ─── Array-shape coercion ─────────────────────────────────────────────────────
// Solenoid's numeric data forms one lattice: a scalar is a 1×1 array, a list is
// a single ROW (CSV orientation: [1,2,3] → [[1,2,3]], 1×3), a table is M×N. The
// `table` socket is the supertype, so a node may receive a number, a number[],
// or a number[][] on any numeric input regardless of its declared shape (cables
// are validated on static type, not live dimensions — see sockets.ts).
//
// These helpers normalize whatever arrives to the shape a node actually wants.
// When the incoming data can't fit (e.g. a 3×3 table where a single value is
// required), they throw ShapeError; the node catches it and shows the message
// in its value box rather than breaking the cable. CSV row-orientation is the
// one rule to remember: a 1-D list is a row, and TRANSPOSE turns it into a
// column when a node needs that.

export type Mat = number[][];

/** Raised when a value's dimensions can't be reduced to the shape a node needs.
 *  Propagates out of the node's `data()` to the error-value guard (errorValue.ts),
 *  which tags it as a #SHAPE! error — surfaced as the red badge and propagated
 *  downstream like every other error. */
export class ShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShapeError";
  }
}

type Numeric = number | number[] | Mat;

function is2D(v: number[] | Mat): v is Mat {
  return v.length > 0 && Array.isArray(v[0]);
}

/**
 * Promote anything numeric to a 2-D matrix. Widening only — never fails.
 *   number      → [[x]]            (1×1)
 *   number[]    → [[...]]          (1×N row, CSV orientation)
 *   number[][]  → unchanged
 */
export function toMatrix(v: Numeric | null | undefined): Mat | null {
  if (v == null) return null;
  if (typeof v === "number") return [[v]];
  if (v.length === 0) return [];
  return is2D(v) ? v : [v as number[]];
}

/**
 * Reduce anything numeric to a 1-D list. A scalar becomes a single-element list;
 * a 1×N or N×1 array flattens; a genuine M×N table (both dims > 1) is a size
 * error — there's no unambiguous list in it.
 */
export function toList(v: Numeric | null | undefined): number[] | null {
  if (v == null) return null;
  if (typeof v === "number") return [v];
  if (v.length === 0) return [];
  if (!is2D(v)) return v as number[];
  const m = v as Mat;
  if (m.length === 1) return [...m[0]];                 // single row
  if (m.every((r) => r.length === 1)) return m.map((r) => r[0]); // single column
  throw new ShapeError(`Expected a list, got a ${m.length}×${m[0]?.length ?? 0} table`);
}

/**
 * Reduce anything numeric to a single value. More than one element is a size
 * error (the node wanted one value, like a threshold or a count).
 */
export function toScalar(v: Numeric | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const flat = is2D(v) ? (v as Mat).flat() : (v as number[]);
  if (flat.length === 1) return flat[0];
  throw new ShapeError(`Expected a single value, got ${flat.length}`);
}

// A 2-D cell — number (date serial included) or text. The reshape nodes accept
// an `any` input (so text/date matrices connect), which coerceInputs leaves raw;
// they promote it to a matrix themselves with this element-agnostic widener.
export type Cell = number | string;

/**
 * Promote any value to a matrix, generic over element type (unlike `toMatrix`,
 * which is numeric): scalar → 1×1, list → single row (CSV orientation), matrix →
 * unchanged. Used by the polymorphic reshapers + the LAMBDA family.
 */
export function toAnyMatrix(v: unknown): Cell[][] | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    return (Array.isArray(v[0]) ? v : [v]) as Cell[][];
  }
  return [[v as Cell]];
}
