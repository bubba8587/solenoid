// Units riding through the value model: the integration layer on top of the
// pure dimensional algebra in `dimension.ts`. Pure — no React / Rete / editor.
//
// Canonical-storage invariant: a tagged value is ALWAYS stored as its magnitude
// in BASE SI for its dimension. The display unit a user chose (km, mph, $) is
// not the value's business.

import {
  type Dim, type Unit, DIMENSIONLESS,
  dimMul, dimDiv, dimPow, dimEqual, isDimensionless, formatDim, parseUnit,
} from "./dimension";
import { solError, isSolError, type SolError } from "./errorValue";
import { isMissing } from "./valueKinds";

// A numeric value carrying a dimension. `value` is the magnitude in BASE SI;
// `dim` is the exponent vector. A dimensionless quantity is NEVER a UnitCell —
// it stays a bare `number`, so `isUnitCell` is a clean discriminator.
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
  /** A PURE RATIO: the dimensions provably CANCELED (`10 m ÷ 2 m`). `dim` is
   *  empty, and the value computes as a plain number everywhere — but it is
   *  KNOWN-dimensionless, so an FC can't re-label it with a physical unit
   *  (`#UNIT!`); number formats (percent, especially) still apply. Renders as
   *  `5:1`. The one exception to "dimensionless ⇒ bare number". */
  readonly ratio?: true;
}

// Bare-number unit adoption: a dimensionless operand adopting a united one
// reads in that operand's DISPLAY unit, not base-SI. SCALE only, never the
// affine offset (adopting into °C is degree-sized — delta semantics). The
// resolver defaults to the dimension.ts table; unitBridge upgrades it at load
// to the full FC unit table. An unresolvable display id keeps the face value.
let _displayScale: (id: string) => number | null = (id) => parseUnit(id)?.scale ?? null;

/** Upgrade the display-id → base-SI scale resolver (unitBridge, at module load). */
export function setDisplayScaleResolver(fn: (id: string) => number | null): void {
  _displayScale = fn;
}

/** A bare face value adopted into a united operand's display unit, as base-SI. */
export function adoptMagnitude(face: number, display: string | undefined): number {
  if (display === undefined || display === "") return face;
  const s = _displayScale(display);
  return s == null || s === 1 ? face : face * s;
}

/** Tag a magnitude as a PURE RATIO — a known-dimensionless cancellation result. */
export function tagRatio(value: number): UnitCell {
  return { __unitCell: true, value, dim: {}, ratio: true };
}

export function isRatio(v: unknown): v is UnitCell {
  return isUnitCell(v) && v.ratio === true;
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
  if (isRatio(v)) return `${mag}:1`; // a pure ratio reads in ratio notation
  const sym = formatDim(dimOf(v));
  return sym ? `${mag} ${sym}` : mag;
}

// Currency is the one axis where the display id IS the unit identity: every
// currency collapses onto the single `currency` base axis with scale 1, so `$5`
// and `5€` store the SAME base magnitude. With no exchange rate, two currency
// cells with DIFFERENT codes are incommensurable.
const CURRENCY_DIM: Dim = { currency: 1 };
function isPureCurrency(v: unknown): boolean {
  return dimEqual(dimOf(v), CURRENCY_DIM);
}
/** True when `a` and `b` are both currency cells with DIFFERENT, known currency
 *  codes — incommensurable (no FX). A currency cell WITHOUT a display id (e.g. a
 *  computed `currency`-dimensioned result) is treated leniently: it adopts, so this
 *  only bites when both sides carry an explicit, conflicting code. */
export function currencyMismatch(a: unknown, b: unknown): boolean {
  if (!isPureCurrency(a) || !isPureCurrency(b)) return false;
  const ca = isUnitCell(a) ? a.display : undefined;
  const cb = isUnitCell(b) ? b.display : undefined;
  return ca != null && cb != null && ca !== cb;
}

export function unitError(detail = ""): SolError {
  return solError(
    "#UNIT!",
    detail ||
      "The units don't match dimensionally, e.g. adding meters to seconds. Convert one side first.",
  );
}

// THE arithmetic unit algebra — one implementation for all seven ops. Operands
// are `number | UnitCell` (a bare number is dimensionless). This is the
// dimensional half of an element-wise op — the caller's per-cell error/null
// contract (`cellShortCircuit` in valueKinds.ts) runs FIRST, so it only ever
// sees present operands.

type Operand = number | UnitCell;

export type ArithmeticOp = "add" | "sub" | "mul" | "div" | "mod" | "pow" | "quotient";

export function arithmeticCell(
  op: ArithmeticOp,
  a: Operand,
  b: Operand,
): number | UnitCell | SolError {
  const da = dimOf(a), db = dimOf(b);
  const x = magnitudeOf(a), y = magnitudeOf(b);
  const dispA = isUnitCell(a) ? a.display : undefined;
  const dispB = isUnitCell(b) ? b.display : undefined;
  const divZero = () => solError("#DIV/0!", "Division by zero");
  // Two DIFFERENT currencies are incommensurable in EVERY op (no exchange rate):
  // +/−/mod can't combine them, and ×/÷ would FABRICATE a rate — the ÷ path mints
  // a pure RATIO, so $10 ÷ 5€ would answer a unitless 2:1, which IS an FX claim.
  // Guarded up front so no op below can forget it (the currency policy sweep in
  // unitCurrencyPolicy.test.ts quantifies over all seven).
  if (currencyMismatch(a, b)) {
    return unitError(`Can't combine ${dispA} and ${dispB} — different currencies, no exchange rate. Convert one side first.`);
  }
  // +/−/mod need commensurable dimensions — BUT a dimensionless operand ADOPTS
  // the other side's unit, read in that side's DISPLAY unit, and the result
  // keeps the dimensioned side's display id. xc/yc are the adoption-scaled
  // magnitudes for these commensurable ops ONLY — ×/÷ keep the face value (a
  // bare factor is a factor: `$5 × 2 = $10`, never "×2 km").
  const xc = isDimensionless(da) && !isDimensionless(db) ? adoptMagnitude(x, dispB) : x;
  const yc = isDimensionless(db) && !isDimensionless(da) ? adoptMagnitude(y, dispA) : y;
  const combine = (r: number): number | UnitCell | SolError => {
    if (dimEqual(da, db)) return tagDim(r, da, dispA ?? dispB);
    if (isDimensionless(da)) return tagDim(r, db, dispB);
    if (isDimensionless(db)) return tagDim(r, da, dispA);
    return unitError();
  };
  // ×/÷ keep the display unit ONLY when the result stays in an operand's dimension
  // (i.e. the other side was dimensionless): `$5 × 2 = $10` keeps `$`, but
  // `5 m × 3 s = 15 m·s` reverts to the derived symbol (neither operand's unit fits).
  const carry = (rd: Dim): string | undefined =>
    dispA && dimEqual(rd, da) ? dispA : dispB && dimEqual(rd, db) ? dispB : undefined;
  switch (op) {
    case "add":
      return combine(xc + yc);
    case "sub":
      return combine(xc - yc);
    case "mul": {
      const rd = dimMul(da, db);
      return tagDim(x * y, rd, carry(rd));
    }
    case "div": {
      if (y === 0) return divZero();
      const rd = dimDiv(da, db);
      // Cancellation mints a PURE RATIO (10 m ÷ 2 m = 5:1) — known-dimensionless,
      // so an FC can't re-label it with a physical unit. Bare ÷ bare stays bare.
      if (isDimensionless(rd) && (isUnitCell(a) || isUnitCell(b))) return tagRatio(x / y);
      return tagDim(x / y, rd, carry(rd));
    }
    case "mod":
      return yc === 0 ? divZero() : combine(xc - yc * Math.floor(xc / yc));
    case "quotient": {
      if (y === 0) return divZero();
      const rd = dimDiv(da, db);
      if (isDimensionless(rd) && (isUnitCell(a) || isUnitCell(b))) return tagRatio(Math.trunc(x / y));
      return tagDim(Math.trunc(x / y), rd, carry(rd));
    }
    case "pow":
      if (!isDimensionless(db)) return unitError("An exponent must be a plain number, not a dimensioned quantity.");
      return tagDim(Math.pow(x, y), dimPow(da, y));
  }
}

/** Compare two dimensioned values (`<`, `>`, `=`): requires commensurable
 *  dimensions (both base SI ⇒ compare magnitudes directly), else `#UNIT!`. Returns
 *  the base-magnitude pair for the caller's comparator, or the error. */
export function compareUnits(a: Operand, b: Operand): { l: number; r: number } | SolError {
  const da = dimOf(a), db = dimOf(b);
  // A dimensionless operand ADOPTS the other's unit, read in the united side's
  // DISPLAY unit. Only two genuinely-different REAL dimensions are incomparable.
  if (!isDimensionless(da) && !isDimensionless(db) && !dimEqual(da, db))
    return unitError("Can't compare values with different units.");
  // …and two different currencies (same dimension, but no exchange rate).
  if (currencyMismatch(a, b))
    return unitError("Can't compare different currencies — no exchange rate.");
  const dispA = isUnitCell(a) ? a.display : undefined;
  const dispB = isUnitCell(b) ? b.display : undefined;
  const l = isDimensionless(da) && !isDimensionless(db) ? adoptMagnitude(magnitudeOf(a), dispB) : magnitudeOf(a);
  const r = isDimensionless(db) && !isDimensionless(da) ? adoptMagnitude(magnitudeOf(b), dispA) : magnitudeOf(b);
  return { l, r };
}

// The unit-aware sibling of valueKinds.ts `forAggregate`: the single chokepoint
// a list reducer runs first. Returns the shared dim (+ the display of the first
// dimensioned cell, so the reducer's result renders in that unit) + the base
// magnitudes; the reducer runs on `nums`, then re-tags via `tagDim`.
export type UnitAggregatePrep =
  | { error: SolError }
  | { error?: undefined; dim: Dim; display?: string; nums: number[] };

export function forAggregateUnits(values: ReadonlyArray<unknown>): UnitAggregatePrep {
  for (const v of values) if (isSolError(v)) return { error: v };
  const present = values.filter((v) => !isMissing(v));
  let dim: Dim | null = null; // the single REAL dimension in the list, if any
  let display: string | undefined;
  let currencyCode: string | undefined; // the list's currency code, once one is seen
  // Pass 1 — the list's single real dimension + display id, BEFORE the magnitudes
  // are read: a LEADING bare number adopts a unit discovered later in the list.
  for (const v of present) {
    const d = dimOf(v);
    if (!isDimensionless(d)) {
      if (dim === null) { dim = d; display = isUnitCell(v) ? v.display : undefined; }
      else if (!dimEqual(dim, d)) {
        return {
          error: unitError(
            `Can't aggregate mixed units: ${formatDim(dim)} and ${formatDim(d)}.`,
          ),
        };
      }
      // Currencies share the `currency` dimension but don't combine across codes
      // (no FX). Track the first explicit code; a conflicting one is a #UNIT!.
      if (isPureCurrency(v) && isUnitCell(v) && v.display != null) {
        if (currencyCode === undefined) currencyCode = v.display;
        else if (currencyCode !== v.display) {
          return { error: unitError(`Can't aggregate different currencies: ${currencyCode} and ${v.display}.`) };
        }
      }
    }
  }
  // Pass 2 — magnitudes: a dimensionless cell ADOPTS `dim` in the list's
  // DISPLAY unit; a united cell contributes its base-SI magnitude directly.
  const nums = present.map((v) =>
    isDimensionless(dimOf(v)) ? adoptMagnitude(magnitudeOf(v), display) : magnitudeOf(v),
  );
  return { dim: dim ?? DIMENSIONLESS, display, nums };
}

// A frame column is homogeneous, so its unit is ONE `ColumnUnit`, not a
// per-cell tag. The cells stay bare base-SI numbers.
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

// A matrix carries ONE unit for the WHOLE grid, attached to the outer array
// under a symbol key so it stays invisible to iteration / JSON / structural
// detection. It is LOSSY by design: a fresh array from a transform drops it, so
// unit-aware matrix ops re-tag explicitly and everything else strips. Matrix
// unit PERSISTENCE rides the producing node, not the array.
const MATRIX_UNIT = Symbol("solMatrixUnit");

/** The unit a matrix carries, or undefined (a plain/structural matrix). */
export function matrixUnitOf(m: unknown): ColumnUnit | undefined {
  return Array.isArray(m) ? (m as { [MATRIX_UNIT]?: ColumnUnit })[MATRIX_UNIT] : undefined;
}

/** Attach (or clear, with undefined) a matrix's whole-grid unit, returning the SAME
 *  array. A dimensionless/empty unit clears the tag so a plain matrix stays plain. */
export function withMatrixUnit<T>(m: T, unit: ColumnUnit | undefined): T {
  if (!Array.isArray(m)) return m;
  const holder = m as unknown as { [MATRIX_UNIT]?: ColumnUnit };
  if (unit && !isDimensionless(unit.dim)) {
    Object.defineProperty(m, MATRIX_UNIT, { value: unit, enumerable: false, writable: true, configurable: true });
  } else if (MATRIX_UNIT in holder) {
    delete holder[MATRIX_UNIT];
  }
  return m;
}

/** Carry `src`'s matrix unit onto `dst` (a fresh array from a unit-carrying op). */
export function carryMatrixUnit<T>(dst: T, src: unknown): T {
  return withMatrixUnit(dst, matrixUnitOf(src));
}

/** The unit shared by EVERY matrix in `mats`, or undefined if they disagree (or any
 *  is untagged). For a combiner (VSTACK/HSTACK) the result can only claim ONE unit
 *  when all its parts carry the SAME one — a km grid stacked on a mi grid, or on an
 *  untagged grid, has no single honest unit, so it strips (mirrors forAggregateUnits'
 *  uniform-or-nothing rule for the structural case). */
export function sharedMatrixUnit(mats: readonly unknown[]): ColumnUnit | undefined {
  if (mats.length === 0) return undefined;
  const first = matrixUnitOf(mats[0]);
  if (!first) return undefined;
  for (let i = 1; i < mats.length; i++) {
    if (!sameColumnUnit(first, matrixUnitOf(mats[i]))) return undefined;
  }
  return first;
}
