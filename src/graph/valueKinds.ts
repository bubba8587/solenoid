// [[C24]] arraySemantics
import { coreReadDecimal, coreReadLogical } from "./engineWasm";

export type Missing = null;

export function numberToLogical(n: number): boolean {
  return n !== 0;
}

/** A value read as a logical ([[C58]] tableInputRawText, [[B17]] typedValueModel): a boolean as itself, a finite number or
 *  numeric text as true when non-zero, and other text only as `true` or `false` in any case. Blank is null; anything
 *  else is NaN: a cell shows it, and a computation turns it into `#TYPE!`. */
export function coerceLogical(v: unknown): boolean | null | number {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? numberToLogical(v) : NaN;
  if (typeof v === "string") {
    const r = coreReadLogical(v);
    return r === undefined ? null : Number.isNaN(r) ? NaN : r === 1;
  }
  return NaN;
}

export function coerceNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (isUncertain(v)) return v.value;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return decimalFromText(v);
  return NaN;
}


/** The one text-to-number reading: plain decimal or scientific, or thousands grouped by commas, trimmed. Anything else, a `0x`/`0b`/`0o` radix prefix or `Infinity` included, is NaN. */
export function decimalFromText(text: string): number {
  return coreReadDecimal(text);
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

export type Tri = boolean | Missing;
