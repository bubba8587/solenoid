import { isSolError, solError, type SolError } from "./errorValue";

// Call sites use the predicate rather than `=== null` so a representation change
// has one place to move.
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

// Liberal coercion for the EXPLICIT path (Cast → Boolean, Get Column read-as Logical),
// deliberately distinct from frame.ts's conservative `isLogicalCell`. `null` = not
// readable as a logical at all; the CALLER decides what that means.
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

// NaN signals "not a number" — the CALLER decides what that means (a formula impl
// returns #VALUE!, goal-seek gives up on the objective).
export function coerceNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (isUncertain(v)) return v.value; // an error bar collapses to its central estimate
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

// `value ± error`, `error` a non-negative 1σ. SCOPED to the composite subsystem — NOT
// threaded through general graph arithmetic; a numeric consumer takes the central `value`.
export interface UncertainNumber {
  readonly kind: "uncertain";
  readonly value: number;
  readonly error: number;
  /** The raw draws behind a Monte Carlo summary — powers the histogram. Not part
   *  of the identity: a hand-built `value ± error` omits it. */
  readonly samples?: readonly number[];
}

export function isUncertain(v: unknown): v is UncertainNumber {
  return (
    typeof v === "object" && v !== null &&
    (v as { kind?: unknown }).kind === "uncertain" &&
    typeof (v as { value?: unknown }).value === "number" &&
    typeof (v as { error?: unknown }).error === "number"
  );
}

/** Normalizes the error bar to |error| (a σ is non-negative). */
export function uncertain(value: number, error: number, samples?: readonly number[]): UncertainNumber {
  const e = Math.abs(error);
  return samples ? { kind: "uncertain", value, error: e, samples } : { kind: "uncertain", value, error: e };
}

/** The one place error bars collapse when an uncertain value meets a plain-number
 *  context. */
export function uncertainCenter(v: number | UncertainNumber): number {
  return isUncertain(v) ? v.value : v;
}

/** The normalizer every propagation op runs on its operands. */
export function asUncertain(v: number | UncertainNumber): UncertainNumber {
  return isUncertain(v) ? v : { kind: "uncertain", value: v, error: 0 };
}

// First-order Gaussian propagation, independent variables (no covariance term).
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
  // d(ab) = √((b·σa)² + (a·σb)²) — the a=0 / b=0 safe form of |ab|·√((σa/a)²+(σb/b)²).
  return uncertain(x.value * y.value, Math.hypot(y.value * x.error, x.value * y.error));
}
export function divUncertain(a: number | UncertainNumber, b: number | UncertainNumber): UncertainNumber {
  const x = asUncertain(a), y = asUncertain(b);
  const q = x.value / y.value;
  // d(a/b) = √((σa/b)² + (a·σb/b²)²) — safe when a=0 (a zero denominator still
  // yields ±Inf/NaN, as any division by zero does).
  const err = Math.hypot(x.error / y.value, (x.value * y.error) / (y.value * y.value));
  return uncertain(q, err);
}

export const COMPUTE = Symbol("compute");
export type CellShort = SolError | Missing | typeof COMPUTE;

/** The full contract (error → missing → compute): the short-circuit value for a
 *  determined cell, or COMPUTE when the op should run. */
export function cellShortCircuit(args: ReadonlyArray<unknown>): CellShort {
  for (const a of args) if (isSolError(a)) return a; // first error wins, unmorphed
  for (const a of args) if (isMissing(a)) return null; // else missing → missing
  return COMPUTE;
}

/** The error half only — for broadcasters (the Kleene logic family) that handle
 *  `null` inside their own fn but must still short-circuit an error cell. */
export function cellError(args: ReadonlyArray<unknown>): SolError | undefined {
  for (const a of args) if (isSolError(a)) return a;
  return undefined;
}

// Runs per output cell AFTER the op: cellShortCircuit gates the inputs, this the RESULT.
export function guardFinite(result: number, ...inputs: unknown[]): number | SolError {
  if (Number.isFinite(result)) return result;
  if (Number.isNaN(result)) {
    return solError("#DOMAIN!", "The result is undefined: an indeterminate operation such as ∞ − ∞, 0 × ∞, or a value outside the function's domain.");
  }
  const fromInfiniteInput = inputs.some((v) => v === Infinity || v === -Infinity);
  return fromInfiniteInput ? result : solError("#OVERFLOW!", "The result is too large to represent; the true value exceeds the numeric range.");
}

// Kleene three-valued logic: T / F / N(=null), matching Polars, pandas and ANSI SQL.
export type Tri = boolean | Missing;

export function kleeneNot(a: Tri): Tri {
  return isMissing(a) ? null : !a;
}

export function kleeneOr(a: Tri, b: Tri): Tri {
  if (a === true || b === true) return true; // T wins regardless of the other
  if (isMissing(a) || isMissing(b)) return null; // unknown could be T
  return false; // both F
}

export function kleeneAnd(a: Tri, b: Tri): Tri {
  if (a === false || b === false) return false; // F wins regardless of the other
  if (isMissing(a) || isMissing(b)) return null; // unknown could be F
  return true; // both T
}

// The single chokepoint every list reducer (SUM/AVERAGE/MIN/…) runs first.
export type AggregatePrep =
  | { error: SolError }
  | { error?: undefined; nums: number[] };

export function forAggregate(values: ReadonlyArray<unknown>): AggregatePrep {
  for (const v of values) {
    if (isSolError(v)) return { error: v };
  }
  // Only NUMERIC cells aggregate (callers coerce logicals first): a text cell must not
  // ride into sum's `+` (concatenation) or min/max's `<` (lexical).
  const nums = values.filter((v): v is number => typeof v === "number");
  return { nums };
}
