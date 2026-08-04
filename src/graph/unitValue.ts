// Canonical storage: a tagged value is ALWAYS its magnitude in BASE SI.

import {
  type Dim, type Unit, DIMENSIONLESS,
  dimMul, dimDiv, dimPow, dimEqual, isDimensionless, formatDim, parseUnit,
} from "./dimension";
import { solError, isSolError, type SolError } from "./errorValue";
import { isMissing } from "./valueKinds";

// A dimensionless quantity is NEVER a UnitCell — it stays a bare `number`, so
// `isUnitCell` is a clean discriminator.
export interface UnitCell {
  readonly __unitCell: true;
  readonly value: number;
  readonly dim: Dim;
  /** The display unit id the value was AUTHORED to render in — the stored `value`
   *  stays base SI. Rides through passthroughs and DROPS at any transform; absent
   *  ⇒ render the derived symbol. */
  readonly display?: string;
  /** A PURE RATIO (`10 m ÷ 2 m`): KNOWN-dimensionless, so an FC can't re-label it
   *  with a physical unit; renders `5:1`. The one exception to
   *  "dimensionless ⇒ bare number". */
  readonly ratio?: true;
}

// A dimensionless operand adopting a united one reads in that operand's DISPLAY
// unit, not base SI: SCALE only, never the affine offset (delta semantics).
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

/** `null` / `SolError` / non-numeric carry no unit → dimensionless. */
export function dimOf(v: unknown): Dim {
  return isUnitCell(v) ? v.dim : DIMENSIONLESS;
}

/** `NaN` for anything non-numeric — the caller's `cellShortCircuit` runs first. */
export function magnitudeOf(v: unknown): number {
  if (isUnitCell(v)) return v.value;
  return typeof v === "number" ? v : NaN;
}

/** The ONE constructor: every algebra result funnels through it, collapsing a
 *  dimensionless result to a bare number so the invariant can't be violated. */
export function tagDim(value: number, dim: Dim, display?: string): UnitCell | number {
  if (isDimensionless(dim)) return value;
  return display ? { __unitCell: true, value, dim, display } : { __unitCell: true, value, dim };
}

/** The FC/Convert re-display path; a no-op on anything that isn't a UnitCell. */
export function withDisplay(v: unknown, display: string): unknown {
  return isUnitCell(v) ? { __unitCell: true, value: v.value, dim: v.dim, display } : v;
}

/** Normalises a named-unit magnitude to base SI, consuming any affine (temperature)
 *  offset HERE so a stored value stays purely linear and `+`/`−` stay plain adds. */
export function fromUnit(value: number, unit: Unit, display?: string): UnitCell | number {
  const base = value * unit.scale + (unit.offset ?? 0);
  return tagDim(base, unit.dim, display);
}

/** The display symbol for a value's dimension ("m/s", "N", "" for dimensionless). */
export function unitLabelOf(v: unknown): string {
  return formatDim(dimOf(v));
}

export function formatUnitCell(v: number | UnitCell, fmtNum: (n: number) => string): string {
  const mag = fmtNum(magnitudeOf(v));
  if (isRatio(v)) return `${mag}:1`;
  const sym = formatDim(dimOf(v));
  return sym ? `${mag} ${sym}` : mag;
}

// Every currency collapses onto the single `currency` axis with scale 1, so two
// currency cells with DIFFERENT codes are incommensurable (there is no FX rate).
const CURRENCY_DIM: Dim = { currency: 1 };
function isPureCurrency(v: unknown): boolean {
  return dimEqual(dimOf(v), CURRENCY_DIM);
}
/** A currency cell WITHOUT a display id adopts, so this bites only when BOTH sides
 *  carry an explicit, conflicting code. */
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

// The dimensional half of an element-wise op: the caller's `cellShortCircuit`
// contract runs FIRST, so this only ever sees present operands.

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
  // Different currencies are incommensurable in EVERY op — ×/÷ would FABRICATE a
  // rate — so guard up front where no op below can forget it.
  if (currencyMismatch(a, b)) {
    return unitError(`Can't combine ${dispA} and ${dispB} — different currencies, no exchange rate. Convert one side first.`);
  }
  // A dimensionless operand ADOPTS the other side's DISPLAY unit for +/−/mod ONLY;
  // ×/÷ keep the face value (a bare factor is a factor: `$5 × 2 = $10`).
  const xc = isDimensionless(da) && !isDimensionless(db) ? adoptMagnitude(x, dispB) : x;
  const yc = isDimensionless(db) && !isDimensionless(da) ? adoptMagnitude(y, dispA) : y;
  const combine = (r: number): number | UnitCell | SolError => {
    if (dimEqual(da, db)) return tagDim(r, da, dispA ?? dispB);
    if (isDimensionless(da)) return tagDim(r, db, dispB);
    if (isDimensionless(db)) return tagDim(r, da, dispA);
    return unitError();
  };
  // ×/÷ keep a display unit ONLY when the result stays in an operand's dimension;
  // `5 m × 3 s` fits neither, so it reverts to the derived symbol.
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
      // Cancellation mints a PURE RATIO so an FC can't re-label it; bare ÷ bare stays bare.
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

/** Returns the base-magnitude pair for the caller's comparator, or `#UNIT!` when
 *  the dimensions aren't commensurable. */
export function compareUnits(a: Operand, b: Operand): { l: number; r: number } | SolError {
  const da = dimOf(a), db = dimOf(b);
  // Only two genuinely-different REAL dimensions are incomparable.
  if (!isDimensionless(da) && !isDimensionless(db) && !dimEqual(da, db))
    return unitError("Can't compare values with different units.");
  if (currencyMismatch(a, b))
    return unitError("Can't compare different currencies — no exchange rate.");
  const dispA = isUnitCell(a) ? a.display : undefined;
  const dispB = isUnitCell(b) ? b.display : undefined;
  const l = isDimensionless(da) && !isDimensionless(db) ? adoptMagnitude(magnitudeOf(a), dispB) : magnitudeOf(a);
  const r = isDimensionless(db) && !isDimensionless(da) ? adoptMagnitude(magnitudeOf(b), dispA) : magnitudeOf(b);
  return { l, r };
}

// The unit-aware sibling of `forAggregate`: the chokepoint a list reducer runs
// first, returning the shared dim + base magnitudes to re-tag via `tagDim`.
export type UnitAggregatePrep =
  | { error: SolError }
  | { error?: undefined; dim: Dim; display?: string; nums: number[] };

export function forAggregateUnits(values: ReadonlyArray<unknown>): UnitAggregatePrep {
  for (const v of values) if (isSolError(v)) return { error: v };
  const present = values.filter((v) => !isMissing(v));
  let dim: Dim | null = null; // the single REAL dimension in the list, if any
  let display: string | undefined;
  let currencyCode: string | undefined; // the list's currency code, once one is seen
  // Pass 1 runs BEFORE the magnitudes are read, so a LEADING bare number can adopt
  // a unit discovered later in the list.
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
      // Currencies share the `currency` dimension but don't combine across codes.
      if (isPureCurrency(v) && isUnitCell(v) && v.display != null) {
        if (currencyCode === undefined) currencyCode = v.display;
        else if (currencyCode !== v.display) {
          return { error: unitError(`Can't aggregate different currencies: ${currencyCode} and ${v.display}.`) };
        }
      }
    }
  }
  // Pass 2 — a dimensionless cell ADOPTS `dim` in the list's DISPLAY unit.
  const nums = present.map((v) =>
    isDimensionless(dimOf(v)) ? adoptMagnitude(magnitudeOf(v), display) : magnitudeOf(v),
  );
  return { dim: dim ?? DIMENSIONLESS, display, nums };
}

// A frame column is homogeneous, so its unit is ONE `ColumnUnit`, not a
// per-cell tag. The cells stay bare base-SI numbers.
export interface ColumnUnit {
  dim: Dim;
  /** The display unit id the column was locked to; the values stay base SI. Absent
   *  ⇒ the column renders in its dimension's derived-unit form. */
  display?: string;
}

export function sameColumnUnit(a: ColumnUnit | undefined, b: ColumnUnit | undefined): boolean {
  if (!a || !b) return !a && !b;
  return dimEqual(a.dim, b.dim) && (a.display ?? "") === (b.display ?? "");
}

// ONE unit for the WHOLE grid, keyed by symbol so it stays invisible to iteration
// and JSON, and LOSSY by design: a fresh array drops it, so unit-aware matrix ops
// must re-tag explicitly and persistence rides the producing node.
const MATRIX_UNIT = Symbol("solMatrixUnit");

/** The unit a matrix carries, or undefined (a plain/structural matrix). */
export function matrixUnitOf(m: unknown): ColumnUnit | undefined {
  return Array.isArray(m) ? (m as { [MATRIX_UNIT]?: ColumnUnit })[MATRIX_UNIT] : undefined;
}

/** Mutates and returns the SAME array; a dimensionless/empty unit clears the tag. */
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

/** A combiner can claim ONE unit only when every part carries the SAME one — a km
 *  grid stacked on a mi or untagged grid has no honest unit, so it strips. */
export function sharedMatrixUnit(mats: readonly unknown[]): ColumnUnit | undefined {
  if (mats.length === 0) return undefined;
  const first = matrixUnitOf(mats[0]);
  if (!first) return undefined;
  for (let i = 1; i < mats.length; i++) {
    if (!sameColumnUnit(first, matrixUnitOf(mats[i]))) return undefined;
  }
  return first;
}
