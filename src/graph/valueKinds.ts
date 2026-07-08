// ── Value kinds: missing (null), logical, and how they flow ──────────────────
// The formula/value model carries, besides plain numbers/strings/dates/complex,
// two special kinds that ride INSIDE lists and matrices:
//
//   • `null`  — a MISSING value. Distinct from 0 and from an error. Rendered
//               literally as `null`. SKIPPED by aggregators; PROPAGATES through
//               element-wise ops (a missing operand makes the result missing).
//   • `SolError` — a computation FAILURE (#DIV/0!, #TYPE!, …). PROPAGATES
//               everywhere (element-wise and through aggregators).
//
// (See dev-notes "Array-semantics policy DECISIONS" + "Second-ring decisions".)
// This module is the pure home for the predicates, the Kleene three-valued
// boolean logic, logical↔number coercion, and the aggregator-prep helper. It is
// engine-agnostic and has no React/Rete deps so it can be unit-tested in
// isolation and reused by every host node.
import { isSolError, solError, type SolError } from "./errorValue";

// The missing sentinel is JS `null` (the value frames already store). Use the
// predicate rather than `=== null` at call sites so intent reads clearly and a
// future representation change has one place to move.
export type Missing = null;
export const MISSING: Missing = null;
export function isMissing(v: unknown): v is Missing {
  return v === null;
}

// A logical value is a real JS boolean. It renders TRUE/FALSE but coerces to
// 1/0 in any numeric context (see logicalToNumber).
export function isLogical(v: unknown): v is boolean {
  return typeof v === "boolean";
}

// ── Logical ↔ number coercion ────────────────────────────────────────────────
// Excel + Polars: a logical coerces to 1/0 in arithmetic; a number coerces to a
// logical as "non-zero is true" (the spreadsheet multiply-by-a-condition trick).
// `null` stays `null` either way (missing propagates), errors propagate.
export function logicalToNumber(v: boolean): 1 | 0 {
  return v ? 1 : 0;
}
export function numberToLogical(n: number): boolean {
  return n !== 0;
}

// Liberal coercion of one scalar to a logical, for the EXPLICIT coercion path —
// Cast → Boolean and Get Column read-as Logical. Deliberately distinct from the
// CONSERVATIVE column inference in frame.ts (`isLogicalCell`), which only auto-types
// a column logical when every cell is literally TRUE/FALSE, so a 0/1 mask column
// stays numeric. Once the user opts IN to a logical read, we coerce generously, on
// the same rules the rest of the type system uses: a real boolean passes through;
// "TRUE"/"FALSE" (any case) parse; a number — or a numeric string — follows the
// logical↔number bridge (0 → FALSE, nonzero → TRUE, via numberToLogical). Returns
// `null` when the value can't be read as a logical at all; the CALLER decides what
// that means (Cast tags it #VALUE!, read-as treats it as a missing cell).
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

// ── Per-element broadcast contract ────────────────────────────────────────────
// ONE rule, shared by every element-wise broadcaster (the numeric ones in
// nodes/shared.ts, the formula-layer broadcastCall/unary in excelFormula.ts, and
// the logic family's broadcastEl), decided PER OUTPUT CELL before the op runs:
//
//   1. a SolError operand → that error, UNMORPHED (first in argument order) —
//      the op never sees it, so an error cell can't decay to NaN/"[object Object]";
//   2. else a missing (`null`) operand → `null` — missing propagates (the settled
//      P6 SQL/pandas/Polars model: null+5 is null, not 5);
//   3. else COMPUTE — every operand is present, run the op.
//
// This makes an in-range list cell behave identically to a scalar and to a
// ragged-padded position. The logic (Kleene) family is the one exception on rule
// 2: it feeds `null` INTO its fn (Kleene decides `null AND FALSE = FALSE`), so it
// uses `cellError` (the error half only) rather than `cellShortCircuit`.
export const COMPUTE = Symbol("compute");
export type CellShort = SolError | Missing | typeof COMPUTE;

/** The full contract (error → missing → compute). Returns the short-circuit value
 *  for a determined cell, or the COMPUTE sentinel when the op should run. */
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

// ── Non-finite result guard ────────────────────────────────────────────────────
// Settled model (author 2026-07-02): a COMPUTATION never yields a bare NaN/Infinity
// — those are classified into tagged errors, so a residual NaN can only be dirty
// DATA, never a computed value. Given a numeric result and the operands that made
// it:
//   • NaN  → #DOMAIN! — indeterminate/undefined (∞−∞, ∞/∞, 0×∞, a root/log outside
//     its domain, or a NaN that entered the op).
//   • ±Inf from all-FINITE inputs → #OVERFLOW! — the true answer is a really-big
//     NUMBER the float can't hold (2^5000, EXP(1000)), not a genuine infinity.
//   • ±Inf when an INPUT was already infinite → PASSES THROUGH — a definable
//     infinity (the Constant node's ∞ is first-class: ∞+5=∞, 2×∞=∞, 5/∞=0).
// Runs per output cell AFTER the op, so it composes with the per-cell error/null
// contract (cellShortCircuit gates on the inputs first; a present, finite cell
// computes, then this classifies the RESULT).
export function guardFinite(result: number, ...inputs: unknown[]): number | SolError {
  if (Number.isFinite(result)) return result;
  if (Number.isNaN(result)) {
    return solError("#DOMAIN!", "The result is undefined: an indeterminate operation such as ∞ − ∞, 0 × ∞, or a value outside the function's domain.");
  }
  const fromInfiniteInput = inputs.some((v) => v === Infinity || v === -Infinity);
  return fromInfiniteInput ? result : solError("#OVERFLOW!", "The result is too large to represent; the true value exceeds the numeric range.");
}

// ── Kleene (three-valued) boolean logic ──────────────────────────────────────
// T / F / N(=null). Polars implements this natively; pandas (pd.NA) and ANSI SQL
// use identical tables. Rule of thumb: `null` only propagates when it could
// change the answer.
//   OR  → T if any T, else N if any N, else F
//   AND → F if any F, else N if any N, else T
//   NOT → NOT N = N
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

// ── Aggregator prep ───────────────────────────────────────────────────────────
// The single chokepoint every list reducer (SUM/AVERAGE/MIN/…) runs first:
//   • a `SolError` anywhere PROPAGATES — return it, the aggregate is that error.
//   • `null` (missing) is SKIPPED — dropped from the working set.
// Everything else (finite numbers AND NaN) is kept as-is, so this is a behavior
// no-op for today's all-number lists: NaN still flows exactly as before. Only
// once producers actually emit `null`/`SolError` into lists does it bite.
export type AggregatePrep =
  | { error: SolError }
  | { error?: undefined; nums: number[] };

export function forAggregate(values: ReadonlyArray<unknown>): AggregatePrep {
  for (const v of values) {
    if (isSolError(v)) return { error: v };
  }
  const nums = values.filter((v) => !isMissing(v)) as number[];
  return { nums };
}
