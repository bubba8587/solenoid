// [[C24]], [[D51]], [[D45]] maxRankMatrix (the two-depth rank test), [[D48]] classifyNonFinite (guardFinite), [[D36]] nullSkippedNotZero
import { isSolError, solError, type SolError } from "./errorValue";

// Call sites use this predicate, not `=== null`, so a representation change has one place to move.
export type Missing = null;
export const MISSING: Missing = null;
export function isMissing(v: unknown): v is Missing {
  return v === null;
}

export function isLogical(v: unknown): v is boolean {
  return typeof v === "boolean";
}

export function logicalToNumber(v: boolean): 1 | 0 {
  return v ? 1 : 0;
}
export function numberToLogical(n: number): boolean {
  return n !== 0;
}

export function coerceLogical(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? numberToLogical(v) : null;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
    const n = Number(t);
    return t !== "" && Number.isFinite(n) ? numberToLogical(n) : null;
  }
  return null;
}

export function coerceNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (isUncertain(v)) return v.value;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

export interface UncertainNumber {
  readonly kind: "uncertain";
  readonly value: number;
  readonly error: number;
  readonly samples?: readonly number[];
  readonly dropped?: number;
}

export function isUncertain(v: unknown): v is UncertainNumber {
  return (
    typeof v === "object" && v !== null &&
    (v as { kind?: unknown }).kind === "uncertain" &&
    typeof (v as { value?: unknown }).value === "number" &&
    typeof (v as { error?: unknown }).error === "number"
  );
}

export function uncertain(value: number, error: number, samples?: readonly number[]): UncertainNumber {
  const e = Math.abs(error);
  return samples ? { kind: "uncertain", value, error: e, samples } : { kind: "uncertain", value, error: e };
}

export function uncertainCenter(v: number | UncertainNumber): number {
  return isUncertain(v) ? v.value : v;
}

export function asUncertain(v: number | UncertainNumber): UncertainNumber {
  return isUncertain(v) ? v : { kind: "uncertain", value: v, error: 0 };
}

export function addUncertain(a: number | UncertainNumber, b: number | UncertainNumber): UncertainNumber {
  const x = asUncertain(a), y = asUncertain(b);
  return uncertain(x.value + y.value, Math.hypot(x.error, y.error));
}
export function subUncertain(a: number | UncertainNumber, b: number | UncertainNumber): UncertainNumber {
  const x = asUncertain(a), y = asUncertain(b);
  return uncertain(x.value - y.value, Math.hypot(x.error, y.error));
}
export function mulUncertain(a: number | UncertainNumber, b: number | UncertainNumber): UncertainNumber {
  const x = asUncertain(a), y = asUncertain(b);
  // The a = 0 / b = 0 safe form of |ab|·√((σa/a)² + (σb/b)²).
  return uncertain(x.value * y.value, Math.hypot(y.value * x.error, x.value * y.error));
}
export function divUncertain(a: number | UncertainNumber, b: number | UncertainNumber): UncertainNumber {
  const x = asUncertain(a), y = asUncertain(b);
  const q = x.value / y.value;
  // Safe when a = 0; a zero denominator still yields ±Inf or NaN.
  const err = Math.hypot(x.error / y.value, (x.value * y.error) / (y.value * y.value));
  return uncertain(q, err);
}

export const COMPUTE = Symbol("compute");
export type CellShort = SolError | Missing | typeof COMPUTE;

export function cellShortCircuit(args: ReadonlyArray<unknown>): CellShort {
  for (const a of args) if (isSolError(a)) return a;
  for (const a of args) if (isMissing(a)) return null;
  return COMPUTE;
}

export function cellError(args: ReadonlyArray<unknown>): SolError | undefined {
  for (const a of args) if (isSolError(a)) return a;
  return undefined;
}

export function guardFinite(result: number, ...inputs: unknown[]): number | SolError {
  if (Number.isFinite(result)) return result;
  if (Number.isNaN(result)) {
    return solError("#DOMAIN!", "The result is undefined: an indeterminate operation such as ∞ − ∞, 0 × ∞, or a value outside the function's domain.");
  }
  const fromInfiniteInput = inputs.some((v) => v === Infinity || v === -Infinity);
  return fromInfiniteInput ? result : solError("#OVERFLOW!", "The result is too large to represent. The true value exceeds the numeric range.");
}

export type Tri = boolean | Missing;

export function kleeneNot(a: Tri): Tri {
  return isMissing(a) ? null : !a;
}

export function kleeneOr(a: Tri, b: Tri): Tri {
  if (a === true || b === true) return true;
  if (isMissing(a) || isMissing(b)) return null;
  return false;
}

export function kleeneAnd(a: Tri, b: Tri): Tri {
  if (a === false || b === false) return false;
  if (isMissing(a) || isMissing(b)) return null;
  return true;
}

export type AggregatePrep =
  | { error: SolError }
  | { error?: undefined; nums: number[] };

export function forAggregate(values: ReadonlyArray<unknown>): AggregatePrep {
  for (const v of values) {
    if (isSolError(v)) return { error: v };
  }
  // Only numeric cells aggregate, so text never rides into sum's `+` (concatenation) or min/max's `<` (lexical).
  const nums = values.filter((v): v is number => typeof v === "number");
  return { nums };
}
