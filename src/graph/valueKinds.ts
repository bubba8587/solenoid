// [[C24]], [[D51]], [[D48]] classifyNonFinite (guardFinite), [[D36]] nullSkippedNotZero
import { solError, type SolError } from "./errorValue";

export type Missing = null;

export function numberToLogical(n: number): boolean {
  return n !== 0;
}

/** A value read as a logical ([[D93]] oneTextReading, [[B17]] typedValueModel): a boolean as itself, a finite number or
 *  numeric text as true when non-zero, and other text only as `true` or `false` in any case. Blank is null; anything
 *  else is NaN: a cell shows it, and a computation turns it into `#TYPE!` (`logicalOrTypeError`). */
export function coerceLogical(v: unknown): boolean | null | number {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? numberToLogical(v) : NaN;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "") return null;
    if (t === "true") return true;
    if (t === "false") return false;
    const n = decimalFromText(t);
    if (Number.isFinite(n)) return numberToLogical(n);
  }
  return NaN;
}

/** `coerceLogical` for a computation: what can't read as a logical is `#TYPE!`, naming the value. */
export function logicalOrTypeError(v: unknown, where: string): boolean | null | SolError {
  const b = coerceLogical(v);
  if (typeof b !== "number") return b;
  return solError("#TYPE!", `${where}: ${typeof v === "string" ? `"${v}"` : String(v)} isn't a logical. Only TRUE, FALSE or a number read as one`);
}

export function coerceNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (isUncertain(v)) return v.value;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return decimalFromText(v);
  return NaN;
}

const DECIMAL_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const GROUPED_TEXT = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/;

/** The one text-to-number reading: plain decimal or scientific, or thousands grouped by commas, trimmed. Anything else, a `0x`/`0b`/`0o` radix prefix or `Infinity` included, is NaN. */
export function decimalFromText(text: string): number {
  const t = text.trim();
  if (DECIMAL_TEXT.test(t)) return Number(t);
  if (GROUPED_TEXT.test(t)) return Number(t.replace(/,/g, ""));
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

const DOMAIN_MESSAGE = "The result is undefined: an indeterminate operation such as ∞ − ∞, 0 × ∞, or a value outside the function's domain.";
const OVERFLOW_MESSAGE = "The result is too large to represent. The true value exceeds the numeric range.";

export function guardFinite(result: number, inputs: ReadonlyArray<unknown>): number | SolError {
  if (Number.isFinite(result)) return result;
  if (Number.isNaN(result)) return solError("#DOMAIN!", DOMAIN_MESSAGE);
  const fromInfiniteInput = inputs.some((v) => v === Infinity || v === -Infinity);
  return fromInfiniteInput ? result : solError("#OVERFLOW!", OVERFLOW_MESSAGE);
}

export type Tri = boolean | Missing;
