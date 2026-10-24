// [[C25]], [[D43]]

import {
  type Dim, type Unit, DIMENSIONLESS,
  dimEqual, isDimensionless, formatDim, parseUnit,
} from "./dimension";
import { solError, type SolError } from "./errorValue";

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

let _displayDim: (id: string) => Dim | null = (id) => parseUnit(id)?.dim ?? null;

export function setDisplayDimResolver(fn: (id: string) => Dim | null): void {
  _displayDim = fn;
}

/** A display unit's scale, offset and dimension as the resolvers read them, for a cell crossing into the core. */
export const displayScale = (id: string): number | null => _displayScale(id);
export const displayOffset = (id: string): number | null => _displayOffset(id);
export const displayDim = (id: string): Dim | null => _displayDim(id);

export function adoptMagnitude(face: number, display: string | undefined): number {
  if (display === undefined || display === "") return face;
  const s = _displayScale(display);
  return s == null || s === 1 ? face : face * s;
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

export function formatUnitCell(v: number | UnitCell, fmtNum: (n: number) => string): string {
  const mag = fmtNum(magnitudeOf(v));
  if (isRatio(v)) return `${mag}:1`;
  const sym = formatDim(dimOf(v));
  return sym ? `${mag} ${sym}` : mag;
}

export function unitError(detail = ""): SolError {
  return solError(
    "#UNIT!",
    detail ||
      "The units don't match dimensionally, e.g. adding meters to seconds. Convert one side first.",
  );
}

export type ArithmeticOp = "add" | "sub" | "mul" | "div" | "mod" | "pow" | "quotient";

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

const decimalExponent = (x: number): number => Number(Math.abs(x).toExponential().split("e")[1]);

/** `y` rounded at the 15th significant digit of `t`, the larger term of the conversion that produced it. */
export function roundAtLargerTerm(y: number, t: number): number {
  if (!Number.isFinite(y) || y === 0 || !Number.isFinite(t)) return y;
  const p = decimalExponent(y) - decimalExponent(t) + 15;
  return p < 1 ? 0 : p > 100 ? y : Number(y.toPrecision(p));
}
