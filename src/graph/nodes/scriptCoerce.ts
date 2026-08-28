// Folds a script's return value onto the value model. Nothing leaves the Script node
// that is not already a Solenoid value, and the value TYPES ITSELF: numbers, text and
// booleans are their own families, a `Date` (or `Solenoid.date(serial)`) is a date,
// a non-number is #DOMAIN!, an unsupported object is #TYPE!; at the top, a shape that
// is neither a value, a list, nor rows of values is #SHAPE!. The inferred family
// drives the result socket (script.ts reconciles it, alongside rank).
//
// Homogeneity follows unitGranularity: a LIST is the one rank with no homogeneity
// guarantee (a mixed list rides the wildcard socket), but a TABLE is single-typed —
// rows mixing families are #AMBIGUOUS!, not an anytable.
import { solError, isSolError } from "../errorValue";
import { jsDateToSerial } from "./dateSerial";
import { isCx } from "../cxValue";
import { isSolDateTag } from "./scriptRun";
import type { ResultType } from "./shared";

function describe(v: unknown): string {
  if (typeof v === "object" && v !== null && "__unclonable" in v) {
    const k = (v as { __unclonable: string }).__unclonable;
    return k === "function" ? "a function" : k === "symbol" ? "a symbol" : `a ${k}`;
  }
  if (Array.isArray(v)) return "a list";
  return typeof v === "object" ? "an object" : `a ${typeof v}`;
}

// The element family a cell carries; blanks and errors carry none.
type CellFamily = "number" | "text" | "date" | "logical" | "complex";
type Vote = CellFamily | "mixed" | null;

function combine(a: Vote, b: Vote): Vote {
  if (a === null) return b;
  if (b === null) return a;
  return a === b ? a : "mixed";
}

/** The socket family a settled vote maps to: logical and complex values are
 *  first-class but have no result socket of their own, so they (and a mixed
 *  LIST) ride the wildcard. */
function toSocketFamily(v: Vote): ResultType | null {
  if (v === null) return null;
  if (v === "number" || v === "text" || v === "date") return v;
  return "auto";
}

function coerceCell(c: unknown): { value: unknown; family: CellFamily | null } {
  if (c === null || c === undefined) return { value: null, family: null };
  if (isSolError(c)) return { value: c, family: null };
  if (isSolDateTag(c)) {
    const n = c.__solDate;
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return { value: solError("#TYPE!", "Solenoid.date takes a date serial number or a Date"), family: null };
    }
    return { value: n, family: "date" };
  }
  if (typeof c === "bigint") {
    if (c > BigInt(Number.MAX_SAFE_INTEGER) || c < -BigInt(Number.MAX_SAFE_INTEGER)) {
      return { value: solError("#OVERFLOW!", "The result is too large to represent exactly"), family: null };
    }
    return { value: Number(c), family: "number" };
  }
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return { value: solError("#DOMAIN!", "The result is an invalid date"), family: null };
    return { value: jsDateToSerial(c), family: "date" };
  }
  if (typeof c === "number") {
    if (Number.isNaN(c)) return { value: solError("#DOMAIN!", "The result is not a number"), family: null };
    return { value: c, family: "number" };
  }
  if (typeof c === "boolean") return { value: c, family: "logical" };
  if (typeof c === "string") return { value: c, family: "text" };
  if (isCx(c)) return { value: c, family: "complex" };
  return { value: solError("#TYPE!", `Returned ${describe(c)}; return numbers, text, booleans, dates, or lists of them`), family: null };
}

/** The whole return value: a scalar, a list, or rows of values (padded with null when
 *  ragged, as every broadcaster pads). Anything deeper or mixed-with-rows is #SHAPE!;
 *  rows mixing families are #AMBIGUOUS!. `family` is the element family the value
 *  votes onto the result socket — null when it casts no vote. */
export function coerceScriptResult(v: unknown): { value: unknown; family: ResultType | null } {
  if (!Array.isArray(v)) {
    const r = coerceCell(v);
    return { value: r.value, family: toSocketFamily(r.family) };
  }
  if (v.length === 0) return { value: [], family: null };
  const rows = v.filter(Array.isArray).length;
  let vote: Vote = null;
  if (rows === 0) {
    const cells = v.map((c) => {
      const r = coerceCell(c);
      vote = combine(vote, r.family);
      return r.value;
    });
    return { value: cells, family: toSocketFamily(vote) };
  }
  if (rows !== v.length) return { value: solError("#SHAPE!", "Returned values mixed with rows; return a list, or a list of rows"), family: null };
  const width = Math.max(...(v as unknown[][]).map((r) => r.length));
  const out: unknown[][] = [];
  for (const row of v as unknown[][]) {
    if (row.some(Array.isArray)) return { value: solError("#SHAPE!", "Returned rows nested deeper than a table; return a list of rows"), family: null };
    const cells = row.map((c) => {
      const r = coerceCell(c);
      vote = combine(vote, r.family);
      return r.value;
    });
    while (cells.length < width) cells.push(null);
    out.push(cells);
  }
  if (vote === "mixed") {
    return { value: solError("#AMBIGUOUS!", "Returned rows that mix value types; a table is single-typed"), family: null };
  }
  return { value: out, family: toSocketFamily(vote) };
}
