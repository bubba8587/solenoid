// ─── Unit value layer — units riding through the value model (Bundle 05: FC A4) ──
// This is the value-model integration layer that sits ON TOP of the pure
// dimensional algebra in `dimension.ts` (exponent-vector units, ×/÷/^,
// commensurability, conversion, derived-unit formatting). It mirrors the shape of
// `valueKinds.ts`: one small pure module every value-consuming node calls, with no
// React / Rete / editor dependency, so it unit-tests in isolation.
//
// Author decisions on record (docs/v2.0/05-units-format-controller.md):
//   • Per-element list units = TAGGED CELLS. A list is a ROW and must allow mixed
//     units, so a unit rides INSIDE a numeric list cell exactly the way
//     valueKinds.ts carries per-cell `null` / `SolError`. The tag is a `UnitCell`.
//   • Matrix = unit-AGNOSTIC always — a matrix cell is never tagged.
//   • Frame = one unit PER COLUMN (`ColumnUnit`), not per cell — a frame column is
//     homogeneous, so the unit lives on the column, not each cell.
//
// Canonical-storage invariant: a tagged value is ALWAYS stored as its magnitude in
// BASE SI for its dimension (metre, second, kilogram, …). The friendly display
// unit a user chose (km, mph, $) is NOT the value's business — that lock rides the
// value through the Format Controller layer (`unitFlow.ts`). Keeping the value at
// base SI makes the algebra trivial and total: `+`/`−` of two same-dimension cells
// is a plain magnitude add (both already base), and derived-unit display is just
// `formatDim` over the dimension vector. "True dimensional algebra, not
// label-carrying" (author) falls straight out of this.

import {
  type Dim, type Unit, DIMENSIONLESS,
  dimMul, dimDiv, dimPow, dimEqual, isDimensionless, formatDim,
} from "./dimension";
import { solError, isSolError, type SolError } from "./errorValue";
import { isMissing } from "./valueKinds";

// ─── The tagged cell ────────────────────────────────────────────────────────────
// A numeric value carrying a dimension. `value` is the magnitude in BASE SI (see
// the storage invariant above); `dim` is the exponent vector. A dimensionless
// quantity is NEVER a UnitCell — it stays a bare `number` — so today's untagged
// number lists are unchanged and `isUnitCell` is a clean discriminator.
export interface UnitCell {
  readonly __unitCell: true;
  readonly value: number;
  readonly dim: Dim;
  /** The display unit id (an FC unit id — "km", "mph", "usd") the value was
   *  AUTHORED to render in (by a Format Controller, a Convert, or a unit-picking
   *  source). The stored `value` is ALWAYS base SI; this is only how it renders.
   *  It rides the value through passthroughs & selectors and DROPS at a transform
   *  — `tagDim` (every algebra result) carries none, so a multiplied/added value
   *  reverts to its derived-symbol form. Absent ⇒ render the derived symbol
   *  (`formatDim`). This is the scalar/list analog of `ColumnUnit.display`. */
  readonly display?: string;
}

export function isUnitCell(v: unknown): v is UnitCell {
  return typeof v === "object" && v !== null &&
    (v as Partial<UnitCell>).__unitCell === true;
}

/** The dimension a value carries: a `UnitCell`'s own dim, else dimensionless.
 *  (`null` / `SolError` / non-numeric → dimensionless — they carry no unit.) */
export function dimOf(v: unknown): Dim {
  return isUnitCell(v) ? v.dim : DIMENSIONLESS;
}

/** The base-SI magnitude a value carries (a `UnitCell`'s stored value, else the
 *  bare number). `NaN` for anything non-numeric — the caller's per-cell error/null
 *  contract (`cellShortCircuit`) is expected to have run first. */
export function magnitudeOf(v: unknown): number {
  if (isUnitCell(v)) return v.value;
  return typeof v === "number" ? v : NaN;
}

/**
 * Tag a BASE-SI magnitude with a dimension, collapsing a dimensionless result to a
 * bare number (so `5 m / 1 m` is the plain number 5, never a zero-exponent cell).
 * This is the ONE constructor — every algebra result funnels through it so the
 * "dimensionless ⇒ bare number" invariant can't be violated.
 */
export function tagDim(value: number, dim: Dim, display?: string): UnitCell | number {
  if (isDimensionless(dim)) return value;
  return display ? { __unitCell: true, value, dim, display } : { __unitCell: true, value, dim };
}

/** Set (or replace) a UnitCell's display unit id — the FC/Convert re-display path.
 *  A no-op on anything that isn't a UnitCell. */
export function withDisplay(v: unknown, display: string): unknown {
  return isUnitCell(v) ? { __unitCell: true, value: v.value, dim: v.dim, display } : v;
}

/**
 * Tag a magnitude expressed in a NAMED unit (from `dimension.ts`'s registry /
 * parser), normalising to base SI: `fromUnit(2, km)` stores `{value: 2000,
 * dim: length}`. Handles the affine (temperature) offset — `fromUnit(20, °C)`
 * stores 293.15 K — so a tagged temperature participates in commensurability
 * checks; the offset is consumed here and never rides on the cell (a stored value
 * is a pure linear magnitude, so `+`/`−` stay plain adds).
 */
export function fromUnit(value: number, unit: Unit, display?: string): UnitCell | number {
  const base = value * unit.scale + (unit.offset ?? 0);
  return tagDim(base, unit.dim, display);
}

/** The display symbol for a value's dimension ("m/s", "N", "" for dimensionless). */
export function unitLabelOf(v: unknown): string {
  return formatDim(dimOf(v));
}

/**
 * Render a `UnitCell` as "magnitude unit" (e.g. `5 m/s`, `12 N`). The magnitude is
 * the stored base-SI value formatted by the caller's number formatter; the unit is
 * the derived-symbol form over the dimension vector. A dimensionless input (a bare
 * number reaching here) formats with no suffix. This is the pure display helper the
 * value boxes / chips call for a dimensioned cell.
 */
export function formatUnitCell(v: number | UnitCell, fmtNum: (n: number) => string): string {
  const mag = fmtNum(magnitudeOf(v));
  const sym = formatDim(dimOf(v));
  return sym ? `${mag} ${sym}` : mag;
}

// ─── The #UNIT! helper ──────────────────────────────────────────────────────────
export function unitError(detail = ""): SolError {
  return solError(
    "#UNIT!",
    detail ||
      "The units don't match dimensionally, e.g. adding metres to seconds. Convert one side first.",
  );
}

// ─── Per-cell dimensional algebra ────────────────────────────────────────────────
// Operands are `number | UnitCell` (a bare number is dimensionless). These are the
// dimensional half of an element-wise op — the caller's per-cell error/null
// contract (`cellShortCircuit` in valueKinds.ts) runs FIRST, so these only ever see
// present, finite, dimensioned operands. Each returns a tagged result (or a bare
// number when the result is dimensionless) OR a `#UNIT!` `SolError`.

type Operand = number | UnitCell;

/** `a × b`: magnitudes multiply, dimensions add. Total (never a unit error). */
export function mulUnits(a: Operand, b: Operand): UnitCell | number {
  return tagDim(magnitudeOf(a) * magnitudeOf(b), dimMul(dimOf(a), dimOf(b)));
}

/** `a ÷ b`: magnitudes divide, dimensions subtract. `5 m ÷ 1 s = 5 m/s`. */
export function divUnits(a: Operand, b: Operand): UnitCell | number {
  return tagDim(magnitudeOf(a) / magnitudeOf(b), dimDiv(dimOf(a), dimOf(b)));
}

/** `a + b`: requires commensurable dimensions (both already base SI ⇒ a plain add),
 *  else `#UNIT!`. Keeps the shared dimension. */
export function addUnits(a: Operand, b: Operand): UnitCell | number | SolError {
  const da = dimOf(a), db = dimOf(b);
  if (!dimEqual(da, db)) {
    return unitError(`Can't add ${formatDim(da) || "a number"} to ${formatDim(db) || "a number"}.`);
  }
  return tagDim(magnitudeOf(a) + magnitudeOf(b), da);
}

/** `a − b`: same commensurability rule as `addUnits`. */
export function subUnits(a: Operand, b: Operand): UnitCell | number | SolError {
  const da = dimOf(a), db = dimOf(b);
  if (!dimEqual(da, db)) {
    return unitError(`Can't subtract ${formatDim(db) || "a number"} from ${formatDim(da) || "a number"}.`);
  }
  return tagDim(magnitudeOf(a) - magnitudeOf(b), da);
}

/** `a ^ n`: `n` must be a plain (dimensionless) number — a dimensioned exponent is
 *  meaningless. Magnitude powers, dimension scales by `n`. */
export function powUnits(a: Operand, n: Operand): UnitCell | number | SolError {
  if (isUnitCell(n)) return unitError("An exponent must be a plain number, not a dimensioned quantity.");
  const e = magnitudeOf(n);
  return tagDim(magnitudeOf(a) ** e, dimPow(dimOf(a), e));
}

/** Compare two dimensioned values (`<`, `>`, `=`): requires commensurable
 *  dimensions (both base SI ⇒ compare magnitudes directly), else `#UNIT!`. Returns
 *  the base-magnitude pair for the caller's comparator, or the error. */
export function compareUnits(a: Operand, b: Operand): { l: number; r: number } | SolError {
  const da = dimOf(a), db = dimOf(b);
  if (!dimEqual(da, db)) return unitError("Can't compare values with different units.");
  return { l: magnitudeOf(a), r: magnitudeOf(b) };
}

// ─── Aggregator prep (step 6) ────────────────────────────────────────────────────
// The unit-aware sibling of valueKinds.ts `forAggregate`: the single chokepoint a
// list reducer (SUM/AVERAGE/MIN/…) runs first. Semantics parallel the value one:
//   • a `SolError` anywhere PROPAGATES (the aggregate is that error);
//   • `null` (missing) is SKIPPED;
//   • every PRESENT cell must share ONE dimension — a length list and a bare number
//     mixed together is a genuine unit error (`#UNIT!`). Because every tagged cell
//     is stored base SI, commensurable-but-differently-authored cells (km + m) are
//     ALREADY unified, so the plan's "convert if commensurable, else #UNIT!" is
//     automatic — no conversion step, just a same-dimension check.
// Returns the shared dim + the base magnitudes; the reducer runs on `nums`, then
// re-tags its result with `dim` via `tagDim`.
export type UnitAggregatePrep =
  | { error: SolError }
  | { error?: undefined; dim: Dim; nums: number[] };

export function forAggregateUnits(values: ReadonlyArray<unknown>): UnitAggregatePrep {
  for (const v of values) if (isSolError(v)) return { error: v };
  const present = values.filter((v) => !isMissing(v));
  let dim: Dim | null = null;
  const nums: number[] = [];
  for (const v of present) {
    const d = dimOf(v);
    if (dim === null) dim = d;
    else if (!dimEqual(dim, d)) {
      return {
        error: unitError(
          `Can't aggregate mixed units: ${formatDim(dim) || "a number"} and ${formatDim(d) || "a number"}.`,
        ),
      };
    }
    nums.push(magnitudeOf(v));
  }
  return { dim: dim ?? DIMENSIONLESS, nums };
}

// ─── Per-column frame units (step 1: frames) ─────────────────────────────────────
// A frame column is homogeneous, so its unit is ONE `ColumnUnit` (the dimension +
// the display unit the column was locked to), not a per-cell tag. The cells stay
// bare base-SI numbers; the column carries the dimension. This is the frame analog
// of a list's tagged cells.
export interface ColumnUnit {
  /** The dimension the column's magnitudes carry. */
  dim: Dim;
  /** The display unit id (a Format-Controller unit id, e.g. "km", "usd") the
   *  column was locked to, for rendering — the value stays base SI. Absent ⇒ the
   *  column renders in its dimension's derived-unit form (`formatDim`). */
  display?: string;
}

export function sameColumnUnit(a: ColumnUnit | undefined, b: ColumnUnit | undefined): boolean {
  if (!a || !b) return !a && !b;
  return dimEqual(a.dim, b.dim) && (a.display ?? "") === (b.display ?? "");
}
