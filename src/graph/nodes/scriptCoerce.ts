// Folds a script's return value onto the value model. Nothing leaves the Script node
// that is not already a Solenoid value, and the value TYPES ITSELF: numbers, text and
// booleans are their own families, a `Date` (or `Solenoid.date(serial)`) is a date,
// a non-number is #DOMAIN!, an unsupported object is #TYPE!; at the top, a shape that
// is neither a value, a list, rows of values, nor `{name: value}` row objects is
// #SHAPE!. The inferred family drives the result socket (script.ts reconciles it,
// alongside rank).
//
// Containers are SINGLE-TYPED, uniformly: a list or table mixing families is
// #AMBIGUOUS!, never a mixed anylist/anytable — mixed-by-nature data is a FRAME, and
// row objects build one (each column typed, per-column homogeneity enforced the same
// way; unitGranularity's "a frame ROW is legitimately mixed" is the frame's job).
import { solError, isSolError } from "../errorValue";
import { jsDateToSerial } from "./dateSerial";
import { isCx } from "../cxValue";
import { isSolDateTag } from "./scriptRun";
import type { ResultType } from "./shared";
import type { ProducedFamily } from "./expression";
import type { FrameValue, FrameColumn, FrameCell, FrameColType } from "../frame";

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
 *  first-class but have no result socket of their own, so they ride the wildcard. */
function toSocketFamily(v: Vote): ResultType | null {
  if (v === null || v === "mixed") return null;
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
  return { value: solError("#TYPE!", `Returned ${describe(c)}; return numbers, text, booleans, dates, lists of them, or {name: value} rows`), family: null };
}

/** A `{name: value}` row destined for a frame — a plain object that is not any of
 *  the value kinds a cell can be. */
function isRowObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    && !(v instanceof Date) && !isSolError(v) && !isSolDateTag(v) && !isCx(v)
    && !("__unclonable" in v);
}

const COL_TYPE: Record<Exclude<CellFamily, "complex">, FrameColType> = {
  number: "number", text: "string", date: "date", logical: "logical",
};

/** Rows of `{name: value}` → a frame: columns are the keys in order of first
 *  appearance, each column typed by its cells and single-typed like any container. */
function buildFrame(rows: Record<string, unknown>[]): { value: unknown; family: ProducedFamily | null } {
  const names: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
  if (names.length === 0) {
    return { value: solError("#SHAPE!", "Returned rows with no named values; give each row at least one {name: value}"), family: null };
  }
  const columns: FrameColumn[] = [];
  for (const name of names) {
    let vote: Vote = null;
    const cells: FrameCell[] = [];
    for (const r of rows) {
      const c = coerceCell(r[name]);
      if (!isSolError(c.value)) vote = combine(vote, c.family);
      if (c.family === "complex") {
        return { value: solError("#TYPE!", `Column "${name}" holds complex numbers; a frame column is numbers, text, dates, or booleans`), family: null };
      }
      cells.push(c.value as FrameCell);
    }
    if (vote === "mixed") {
      return { value: solError("#AMBIGUOUS!", `Column "${name}" mixes value types; a frame column is one type`), family: null };
    }
    const type: FrameColType = vote === null || vote === "complex" ? "string" : COL_TYPE[vote];
    columns.push({ name, type, values: cells });
  }
  const frame: FrameValue = { __frame: true, columns };
  return { value: frame, family: "frame" };
}

/** The whole return value: a scalar, a list, rows of values (padded with null when
 *  ragged, as every broadcaster pads), or `{name: value}` row objects, which become a
 *  FRAME. Anything deeper or mixed-with-rows is #SHAPE!; a list or rows mixing
 *  families is #AMBIGUOUS!. `family` is what the value votes onto the result socket —
 *  null when it casts no vote. */
export function coerceScriptResult(v: unknown): { value: unknown; family: ProducedFamily | null } {
  if (isRowObject(v)) return buildFrame([v]);
  if (!Array.isArray(v)) {
    const r = coerceCell(v);
    return { value: r.value, family: toSocketFamily(r.family) };
  }
  if (v.length === 0) return { value: [], family: null };
  const objRows = v.filter(isRowObject).length;
  if (objRows === v.length) return buildFrame(v as Record<string, unknown>[]);
  if (objRows > 0) {
    return { value: solError("#SHAPE!", "Returned {name: value} rows mixed with other values; a frame is rows of {name: value} only"), family: null };
  }
  const rows = v.filter(Array.isArray).length;
  let vote: Vote = null;
  if (rows === 0) {
    const cells = v.map((c) => {
      const r = coerceCell(c);
      vote = combine(vote, r.family);
      return r.value;
    });
    if (vote === "mixed") {
      return { value: solError("#AMBIGUOUS!", "Returned a list that mixes value types; a list is one type. For a mixed row, return {name: value} rows"), family: null };
    }
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
    return { value: solError("#AMBIGUOUS!", "Returned rows that mix value types; a table is single-typed. For typed columns, return {name: value} rows"), family: null };
  }
  return { value: out, family: toSocketFamily(vote) };
}
