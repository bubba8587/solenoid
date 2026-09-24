// [[C25]], [[D43]]

import {
  type Dim, type Unit, DIMENSIONLESS,
  dimMul, dimDiv, dimPow, dimEqual, isDimensionless, formatDim, parseUnit,
} from "./dimension";
import { solError, isSolError, type SolError } from "./errorValue";
import { isMissing, powerOf } from "./valueKinds";

export interface UnitCell {
  readonly __unitCell: true;
  readonly value: number;
  readonly dim: Dim;
  readonly display?: string;
  readonly ratio?: true;
}

let _displayScale: (id: string) => number | null = (id) => parseUnit(id)?.scale ?? null;

export function setDisplayScaleResolver(fn: (id: string) => number | null): void {
  _displayScale = fn;
}

let _displayOffset: (id: string) => number | null = (id) => parseUnit(id)?.offset ?? null;

export function setDisplayOffsetResolver(fn: (id: string) => number | null): void {
  _displayOffset = fn;
}

export function isAffineDisplay(id: string | undefined): boolean {
  if (id === undefined || id === "") return false;
  const o = _displayOffset(id);
  return o != null && o !== 0;
}

export function adoptMagnitude(face: number, display: string | undefined): number {
  if (display === undefined || display === "") return face;
  const s = _displayScale(display);
  return s == null || s === 1 ? face : face * s;
}

/** A bare face value read as a READING in `display`: the offset too, so 30 beside a °C
 *  reading is 30 °C. Linear units read as `adoptMagnitude`. */
export function adoptReading(face: number, display: string | undefined): number {
  const base = adoptMagnitude(face, display);
  return display ? base + (_displayOffset(display) ?? 0) : base;
}

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

export function dimOf(v: unknown): Dim {
  return isUnitCell(v) ? v.dim : DIMENSIONLESS;
}

export function magnitudeOf(v: unknown): number {
  if (isUnitCell(v)) return v.value;
  return typeof v === "number" ? v : NaN;
}

export function tagDim(value: number, dim: Dim, display?: string): UnitCell | number {
  if (isDimensionless(dim)) return value;
  return display ? { __unitCell: true, value, dim, display } : { __unitCell: true, value, dim };
}

export function withDisplay(v: unknown, display: string): unknown {
  return isUnitCell(v) ? { __unitCell: true, value: v.value, dim: v.dim, display } : v;
}

export function fromUnit(value: number, unit: Unit, display?: string): UnitCell | number {
  const base = value * unit.scale + (unit.offset ?? 0);
  return tagDim(base, unit.dim, display);
}

export function unitLabelOf(v: unknown): string {
  return formatDim(dimOf(v));
}

export function formatUnitCell(v: number | UnitCell, fmtNum: (n: number) => string): string {
  const mag = fmtNum(magnitudeOf(v));
  if (isRatio(v)) return `${mag}:1`;
  const sym = formatDim(dimOf(v));
  return sym ? `${mag} ${sym}` : mag;
}

const CURRENCY_DIM: Dim = { currency: 1 };
function isPureCurrency(v: unknown): boolean {
  return dimEqual(dimOf(v), CURRENCY_DIM);
}
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

type Operand = number | UnitCell;

/** Two temperature readings (°C, °F) have no sum, in any surface ([[C25]] firstClassUnits). */
export const READINGS_ADD = "Temperature readings can't be added. Subtract two for a difference, or average them.";
/** A reading on an offset scale is not a magnitude, so it can't scale or divide. */
export const READINGS_SCALE = "Convert the temperature to kelvin first. An offset unit like °C can't take ×, ÷, mod or ^.";
export const READINGS_FOLD = "A fold over readings must answer a reading each step, like MAX(acc, value).";

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
  if (currencyMismatch(a, b)) {
    return unitError(`Can't combine ${dispA} and ${dispB}: they are different currencies with no exchange rate. Convert one side first.`);
  }
  const xc = isDimensionless(da) && !isDimensionless(db) ? adoptMagnitude(x, dispB) : x;
  const yc = isDimensionless(db) && !isDimensionless(da) ? adoptMagnitude(y, dispA) : y;
  const affine = isUnitCell(a) && isUnitCell(b) && (isAffineDisplay(dispA) || isAffineDisplay(dispB));
  const combine = (r: number): number | UnitCell | SolError => {
    if (dimEqual(da, db)) return tagDim(r, da, affine ? undefined : dispA ?? dispB);
    if (isDimensionless(da)) return tagDim(r, db, dispB);
    if (isDimensionless(db)) return tagDim(r, da, dispA);
    return unitError();
  };
  const readings = isAffineDisplay(dispA) && isAffineDisplay(dispB);
  const affineRefused = (): SolError | null =>
    isAffineDisplay(dispA) || isAffineDisplay(dispB)
      ? unitError(READINGS_SCALE)
      : null;
  const carry = (rd: Dim): string | undefined =>
    dispA && dimEqual(rd, da) ? dispA : dispB && dimEqual(rd, db) ? dispB : undefined;
  switch (op) {
    case "add":
      return readings ? unitError(READINGS_ADD) : combine(xc + yc);
    case "sub":
      return combine(xc - yc);
    case "mul": {
      const refused = affineRefused(); if (refused) return refused;
      const rd = dimMul(da, db);
      return tagDim(x * y, rd, carry(rd));
    }
    case "div": {
      const refused = affineRefused(); if (refused) return refused;
      if (y === 0) return divZero();
      const rd = dimDiv(da, db);
      if (isDimensionless(rd) && (isUnitCell(a) || isUnitCell(b))) return tagRatio(x / y);
      return tagDim(x / y, rd, carry(rd));
    }
    case "mod": {
      const refused = affineRefused(); if (refused) return refused;
      return yc === 0 ? divZero() : combine(xc - yc * Math.floor(xc / yc));
    }
    case "quotient": {
      const refused = affineRefused(); if (refused) return refused;
      if (y === 0) return divZero();
      const rd = dimDiv(da, db);
      if (isDimensionless(rd) && (isUnitCell(a) || isUnitCell(b))) return tagRatio(Math.trunc(x / y));
      return tagDim(Math.trunc(x / y), rd, carry(rd));
    }
    case "pow": {
      const refused = affineRefused(); if (refused) return refused;
      if (!isDimensionless(db)) return unitError("An exponent must be a plain number, not a dimensioned quantity.");
      const p = powerOf(x, y);
      return isSolError(p) ? p : tagDim(p, dimPow(da, y));
    }
  }
}

export function compareUnits(a: Operand, b: Operand): { l: number; r: number } | SolError {
  const da = dimOf(a), db = dimOf(b);
  if (!isDimensionless(da) && !isDimensionless(db) && !dimEqual(da, db))
    return unitError("Can't compare values with different units.");
  if (currencyMismatch(a, b))
    return unitError("Can't compare different currencies. There is no exchange rate.");
  const dispA = isUnitCell(a) ? a.display : undefined;
  const dispB = isUnitCell(b) ? b.display : undefined;
  const l = isDimensionless(da) && !isDimensionless(db) ? adoptReading(magnitudeOf(a), dispB) : magnitudeOf(a);
  const r = isDimensionless(db) && !isDimensionless(da) ? adoptReading(magnitudeOf(b), dispA) : magnitudeOf(b);
  return { l, r };
}

export type UnitAggregatePrep =
  | { error: SolError }
  | { error?: undefined; dim: Dim; display?: string; nums: number[] };

/** `bareIsReading`: a bare number beside readings on an offset scale (°C) is a reading
 *  (MIN, AVERAGE), not a delta (SUM). */
export function forAggregateUnits(values: ReadonlyArray<unknown>, bareIsReading = false): UnitAggregatePrep {
  for (const v of values) if (isSolError(v)) return { error: v };
  const present = values.filter((v) => !isMissing(v));
  let dim: Dim | null = null;
  let display: string | undefined;
  let currencyCode: string | undefined;
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
      if (isPureCurrency(v) && isUnitCell(v) && v.display != null) {
        if (currencyCode === undefined) currencyCode = v.display;
        else if (currencyCode !== v.display) {
          return { error: unitError(`Can't aggregate different currencies: ${currencyCode} and ${v.display}.`) };
        }
      }
    }
  }
  const adopt = bareIsReading ? adoptReading : adoptMagnitude;
  const nums = present.map((v) =>
    isDimensionless(dimOf(v)) ? adopt(magnitudeOf(v), display) : magnitudeOf(v),
  );
  return { dim: dim ?? DIMENSIONLESS, display, nums };
}

export interface ColumnUnit {
  dim: Dim;
  display?: string;
}

export function sameColumnUnit(a: ColumnUnit | undefined, b: ColumnUnit | undefined): boolean {
  if (!a || !b) return !a && !b;
  return dimEqual(a.dim, b.dim) && (a.display ?? "") === (b.display ?? "");
}

const MATRIX_UNIT = Symbol("solMatrixUnit");

export function matrixUnitOf(m: unknown): ColumnUnit | undefined {
  return Array.isArray(m) ? (m as { [MATRIX_UNIT]?: ColumnUnit })[MATRIX_UNIT] : undefined;
}

/** Mutates and returns the same array, so never pass a shared cached array. */
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

export function carryMatrixUnit<T>(dst: T, src: unknown): T {
  return withMatrixUnit(dst, matrixUnitOf(src));
}

export function sharedMatrixUnit(mats: readonly unknown[]): ColumnUnit | undefined {
  if (mats.length === 0) return undefined;
  const first = matrixUnitOf(mats[0]);
  if (!first) return undefined;
  for (let i = 1; i < mats.length; i++) {
    if (!sameColumnUnit(first, matrixUnitOf(mats[i]))) return undefined;
  }
  return first;
}
