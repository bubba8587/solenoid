// ─── Frame: a named-column data table ─────────────────────────────────────────
// A Frame is the "data table" type, distinct from the numeric `table` (matrix,
// used for linear algebra). It is a list of named, typed columns. v1 columns are
// all numeric; the value shape is typed-columns from the start so a text column
// can be added later without a breaking format change (see docs/dev-notes.md).
//
// The user mental model: a Frame is a Matrix (the numeric body) plus a String
// List (the column headers). Build Frame and Split Frame are the literal adapter
// between those two worlds; Get Column / Add Column are the general per-column
// path that a text column would later flow through.
import type { UnitSuffix } from "./unitFormat";
import { parseCsvRows } from "./csv";
import { parseDateToSerial, formatDateSerial, DEFAULT_DATE_FORMAT } from "./nodes/date";
import { isSolError, type SolError } from "./errorValue";
import { coerceLogical } from "./valueKinds";

// A column is one of: numeric, free text, DATE, or LOGICAL. A date column stores
// Excel serials (numbers) just like a numeric column — the `type: "date"` tag is
// the signal that those numbers are dates, so they display formatted and flow as
// dates (the same "a serial is just a number; the type carries date-ness"
// principle the socket layer uses, see sockets.ts isDateType). A logical column
// stores real booleans (rendered TRUE/FALSE, coerced to 1/0 where numbers are
// wanted) — first-class per the array-semantics policy (see dev-notes).
export type FrameColType = "number" | "string" | "date" | "logical";

// A cell value: a number, free text, a real boolean (logical), `null` (missing),
// or a per-cell `SolError` (a computed column that errored in one row). The last
// two are the array-semantics relaxation — a frame is just the table-shaped
// container for the same value kinds a list now carries.
export type FrameCell = number | string | boolean | null | SolError;

export interface FrameColumn {
  name: string;
  type: FrameColType;
  /** Cell values, aligned by row index. `null` is an empty cell. */
  values: FrameCell[];
  /** Numeric columns may carry a unit, so unit propagation survives a frame. */
  unit?: UnitSuffix;
  /** The INPUTTED source text per cell — exactly what the user typed (Frame Input)
   *  or what the file/URL contained (CSV File, Web Source, Import …), BEFORE type
   *  inference rewrote it (a date → a serial, "1"/"true" → a boolean). Present only
   *  on SOURCE frames; a computed/transformed column drops it. The editor's Source
   *  view shows this when present (else the underlying value's raw form). */
  raw?: string[];
}

export interface FrameValue {
  /** Brand: lets display / readout / Display robustly detect a frame value
   *  flowing through an `any` cable, rather than structurally sniffing it. */
  readonly __frame: true;
  columns: FrameColumn[];
  /** Set ONLY on a head-N display preview of a larger frame (a verb node's card,
   *  collected from the backend): the TRUE total row count, so the chip shows
   *  "12,400×N" while only N rows are materialized. Absent on a full frame. */
  __totalRows?: number;
}

export function isFrameValue(v: unknown): v is FrameValue {
  return typeof v === "object" && v !== null && (v as Partial<FrameValue>).__frame === true;
}

/** Row count = the longest column (columns may differ in length after edits). */
export function frameRowCount(f: FrameValue): number {
  return f.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
}

// ─── Header naming ────────────────────────────────────────────────────────────
// Given an optional names list (may be shorter than the column count) and the
// column count, produce exactly `ncols` final, unique names:
//   1. Each column uses its provided non-blank name, else `Col{i+1}` by position.
//   2. Duplicates are de-duped left to right: the first keeps its name, a later
//      one gets the smallest free integer suffix starting at 2 (Date, Name, Date
//      → Date, Name, Date2). Auto-names run through the same pass.
export function makeHeaders(names: ReadonlyArray<string> | undefined, ncols: number): string[] {
  const raw: string[] = [];
  for (let i = 0; i < ncols; i++) {
    const given = names?.[i];
    const trimmed = typeof given === "string" ? given.trim() : "";
    raw.push(trimmed !== "" ? trimmed : `Col${i + 1}`);
  }
  const seen = new Set<string>();
  return raw.map((name) => {
    if (!seen.has(name)) { seen.add(name); return name; }
    let n = 2;
    while (seen.has(`${name}${n}`)) n++;
    const unique = `${name}${n}`;
    seen.add(unique);
    return unique;
  });
}

// ─── Build / Split (the Matrix ⇄ Frame adapter) ───────────────────────────────

/** Build a numeric Frame from a row-major matrix and a header String List.
 *  Columns are the matrix's columns; names follow makeHeaders. */
export function buildFrame(matrix: number[][], names?: ReadonlyArray<string>): FrameValue {
  const ncols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
  const headers = makeHeaders(names, ncols);
  const columns: FrameColumn[] = headers.map((name, j) => ({
    name,
    type: "number",
    values: matrix.map((row) => (row[j] === undefined ? null : row[j])),
  }));
  return { __frame: true, columns };
}

/** Split a Frame into its numeric Matrix (row-major) and the full header list.
 *  The Matrix is all-or-nothing: a Frame with any text column has no clean numeric
 *  matrix, so `matrix` is null then (pull individual columns with Get Column). The
 *  header list is always the complete set of column names, mixed or not. */
export function splitFrame(f: FrameValue): { matrix: number[][] | null; headers: string[] } {
  const headers = f.columns.map((c) => c.name);
  if (frameHasTextColumns(f)) return { matrix: null, headers };
  const rows = frameRowCount(f);
  const matrix: number[][] = Array.from({ length: rows }, (_, i) =>
    f.columns.map((c) => {
      const v = c.values[i];
      if (typeof v === "number") return v;
      if (typeof v === "boolean") return v ? 1 : 0; // a logical column splits to 1/0
      return NaN; // null / text / per-cell error have no numeric value here
    }),
  );
  return { matrix, headers };
}

/** Does the frame have any TEXT column (so Split would drop data)? Date columns
 *  hold serials (numbers), so they DON'T block the numeric matrix — only genuine
 *  string columns do. */
export function frameHasTextColumns(f: FrameValue): boolean {
  return f.columns.some((c) => c.type === "string");
}

/** Format one cell for DISPLAY by its column type — a date column's serials show
 *  as date strings, a logical cell as TRUE/FALSE, a per-cell error as its #CODE!,
 *  everything else passes through as its raw value. (The popup editor uses the raw
 *  `values`, not this, so editing stays literal.) */
export function formatFrameCell(type: FrameColType, v: FrameCell): number | string | null {
  if (isSolError(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (type === "date" && typeof v === "number" && Number.isFinite(v)) {
    return formatDateSerial(v, DEFAULT_DATE_FORMAT);
  }
  return v;
}

// ─── Column access ────────────────────────────────────────────────────────────

/** Find a column by name (case-sensitive, exact), else by 1-based index when
 *  `name` is a bare integer string, else null. */
export function getColumn(f: FrameValue, name: string): FrameColumn | null {
  const key = name.trim();
  const byName = f.columns.find((c) => c.name === key);
  if (byName) return byName;
  if (/^\d+$/.test(key)) {
    const idx = parseInt(key, 10) - 1;
    if (idx >= 0 && idx < f.columns.length) return f.columns[idx];
  }
  return null;
}

/** Append (or replace, when the name already exists) a column. Returns a new
 *  frame; de-dupes the name against the others when appending. */
export function addColumn(
  f: FrameValue,
  name: string,
  values: FrameCell[],
  type: FrameColType = "number",
): FrameValue {
  const existingIdx = f.columns.findIndex((c) => c.name === name.trim());
  if (existingIdx >= 0) {
    const columns = f.columns.map((c, i) =>
      i === existingIdx ? { ...c, type, values, raw: undefined } : c, // replaced data is computed — no source text
    );
    return { __frame: true, columns };
  }
  const others = f.columns.map((c) => c.name);
  const [finalName] = makeHeaders([...others, name], others.length + 1).slice(-1);
  return { __frame: true, columns: [...f.columns, { name: finalName, type, values }] };
}

// ─── Frame Input (editable in-node LITERAL source) ──────────────────────────────
// The Frame Input is a LITERAL source: it stores exactly the text the user typed,
// per cell, plus each column's chosen type — it NEVER rewrites your input. The
// typed FrameValue that flows downstream (booleans, date serials, numbers) is
// DERIVED from that raw text at compute time (deriveFrame); the editor's
// Source/Formatted toggle shows the raw text vs the derived render. So a Boolean
// column holding both "1" and "TRUE" keeps both literally; only the value LEAVING
// the node is coerced. (See dev-notes "Frame Input literal source".)

/** One column of the editable source: a name, the user's chosen type, and the RAW
 *  text typed per cell (never coerced). */
export interface FrameSourceColumn {
  name: string;
  type: FrameColType;
  cells: string[];
}
export type FrameSource = FrameSourceColumn[];

/** Coerce ONE raw cell to its typed value — the value boundary. Blank → null
 *  (missing); a string keeps its text verbatim; number/date parse numerically
 *  (date falls back to the ISO text parser); logical uses the shared coerceLogical
 *  (so "1"/"0"/"true"/"false" all read, matching Cast → Boolean). */
export function coerceFrameCell(type: FrameColType, raw: string): FrameCell {
  if (type === "string") return raw === "" ? null : raw;
  const s = raw.trim();
  if (s === "") return null;
  if (type === "logical") return coerceLogical(s);
  const n = cellToNumber(s);
  if (n !== null) return n;
  if (type === "date") { const d = parseDateToSerial(s); return Number.isFinite(d) ? d : NaN; }
  return NaN;
}

/** Derive the typed FrameValue (what flows downstream) from the raw source. The
 *  raw cells ride along as `raw` so a Frame Input's value shows its literal source
 *  even when viewed read-only (a Display node, a Build Frame). */
export function deriveFrame(source: FrameSource): FrameValue {
  return {
    __frame: true,
    columns: source.map((c) => ({
      name: c.name,
      type: c.type,
      values: c.cells.map((cell) => coerceFrameCell(c.type, cell)),
      raw: c.cells,
    })),
  };
}

/** Serialize the raw source to the stored `frameText` (JSON). */
export function frameSourceToText(source: FrameSource): string {
  return JSON.stringify(source.map((c) => ({ name: c.name, type: c.type, cells: c.cells })));
}

/** Infer just a column's TYPE from raw cells (same rules as inferColumn, cells kept
 *  raw): all-numeric → number; else all-TRUE/FALSE → logical; else all-ISO → date;
 *  else text. Used to type a hand-typed CSV / freshly-imported source. */
function inferColType(cells: ReadonlyArray<string>): FrameColType {
  const nonBlank = cells.filter((c) => !isBlank(c));
  if (nonBlank.length === 0) return "string";
  if (nonBlank.every((c) => cellToNumber(c) !== null)) return "number";
  if (nonBlank.every(isLogicalCell)) return "logical";
  if (nonBlank.every(isDateCell)) return "date";
  return "string";
}

/** Parse stored `frameText` → the raw editable source. The JSON `cells` form is
 *  read directly; an OLDER typed-`values` JSON is stringified back to raw cells
 *  (a boolean → "TRUE"/"FALSE", a serial → its digits) so old saves still load;
 *  anything else is the hand-typed / legacy CSV (header row + raw rows), with each
 *  column's type inferred and the cells kept as the exact text typed. */
export function parseFrameSource(text: string): FrameSource {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const raw = JSON.parse(trimmed) as Array<Partial<FrameSourceColumn> & { values?: unknown[] }>;
      if (Array.isArray(raw)) {
        const names = makeHeaders(raw.map((c) => (typeof c?.name === "string" ? c.name : "")), raw.length);
        return raw.map((c, i) => {
          const type: FrameColType = c?.type === "string" ? "string" : c?.type === "date" ? "date"
            : c?.type === "logical" ? "logical" : "number";
          const cells = Array.isArray(c?.cells)
            ? (c!.cells as unknown[]).map((x) => (x == null ? "" : String(x)))
            : Array.isArray(c?.values)
              ? (c!.values as unknown[]).map((x) =>
                  x == null ? "" : typeof x === "boolean" ? (x ? "TRUE" : "FALSE") : String(x))
              : [];
          return { name: names[i], type, cells };
        });
      }
    } catch { /* malformed — fall through to the legacy CSV reader */ }
  }
  const rows = parseCsvRows(trimmed);
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const body = rows.slice(1);
  const ncols = Math.max(headers.length, body.reduce((m, r) => Math.max(m, r.length), 0));
  const names = makeHeaders(headers, ncols);
  return names.map((name, j) => {
    const cells = body.map((r) => (r[j] ?? "").trim());
    return { name, type: inferColType(cells), cells };
  });
}

/** Serialize typed columns to the stored form (JSON). Retained for back-compat /
 *  callers that hold a typed Frame; the editor now stores the raw source instead. */
export function frameColumnsToInputText(columns: ReadonlyArray<FrameColumn>): string {
  return JSON.stringify(columns.map((c) => ({ name: c.name, type: c.type, values: c.values })));
}

/** The typed FrameValue from stored text — derive ∘ parse. Used by the node's
 *  data() and anywhere a Frame Input's value is needed directly. */
export function frameFromInputText(text: string): FrameValue {
  return deriveFrame(parseFrameSource(text));
}


/** Build an all-numeric Frame from a header list + numeric body, honoring the
 *  headers even when the body has fewer columns or no rows (an empty grid still
 *  yields named, empty columns). buildFrame derives column count from the matrix
 *  alone, which would drop named-but-empty columns — this keeps them. */
export function frameFromInput(headers: ReadonlyArray<string>, matrix: number[][]): FrameValue {
  const bodyCols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
  const ncols = Math.max(headers.length, bodyCols);
  const names = makeHeaders(headers, ncols);
  const columns: FrameColumn[] = names.map((name, j) => ({
    name,
    type: "number",
    values: matrix.map((row) => (row[j] === undefined ? null : row[j])),
  }));
  return { __frame: true, columns };
}

// ─── Type-inferring builders (CSV / JSON imports keep text) ─────────────────────
// A column is numeric only when every non-blank cell is a finite number (numeric
// strings allowed, commas stripped); otherwise it's a text column with the
// original strings preserved. Blank cells → null. This is what lets a real-world
// table (names, categories) survive import instead of collapsing to NaN.

function cellToNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    // Strip commas ONLY when they sit in genuine thousands-group positions
    // ("1,234,567.8"). A blanket strip read the European decimal comma "3,5"
    // as 35 — silent corruption. An ambiguous comma string stays text (null
    // here), preserved for an explicit Get Column conversion.
    const grouped = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t);
    const n = Number(grouped ? t.replace(/,/g, "") : t);
    return Number.isFinite(n) ? n : null; // null = not a number
  }
  return null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

// Conservative date detection: ONLY unambiguous ISO-ish forms (YYYY-MM-DD, with
// an optional time), so years / bare numbers / locale-ambiguous "1/2/26" never
// get mistaken for dates. Anything we don't auto-detect can still be converted
// explicitly via Get Column read-as Date.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
function isDateCell(v: unknown): boolean {
  return typeof v === "string" && ISO_DATE.test(v.trim()) && Number.isFinite(parseDateToSerial(v));
}

// A logical cell is exactly TRUE/FALSE (case-insensitive), or a real boolean.
// Restricted to those literals so a numeric 0/1 column stays numeric (the spreadsheet
// "multiply by a mask" trick) and only genuine boolean text reads as logical — matching
// how pandas/Polars infer a bool column on import.
function isLogicalCell(v: unknown): boolean {
  if (typeof v === "boolean") return true;
  if (typeof v !== "string") return false;
  const t = v.trim().toLowerCase();
  return t === "true" || t === "false";
}
function cellToBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return String(v).trim().toLowerCase() === "true";
}

/** Infer one column's type from raw cells and build it. Numeric → number; else
 *  all-TRUE/FALSE → logical; else unambiguous ISO dates → date (stored as serials);
 *  else free text. (Numeric runs first so a 0/1 mask stays numeric.) */
export function inferColumn(name: string, cells: ReadonlyArray<unknown>): FrameColumn {
  // The inputted source text per cell, kept so the editor's Source view can show
  // exactly what came in (a date before it became a serial, "1" before it became a
  // boolean). A blank → "" (an empty source cell), aligned with the null value.
  const raw = cells.map((c) => (isBlank(c) ? "" : String(c).trim()));
  const nonBlank = cells.filter((c) => !isBlank(c));
  const numeric = nonBlank.length > 0 && nonBlank.every((c) => cellToNumber(c) !== null);
  if (numeric) {
    return { name, type: "number", values: cells.map((c) => (isBlank(c) ? null : cellToNumber(c))), raw };
  }
  const logical = nonBlank.length > 0 && nonBlank.every(isLogicalCell);
  if (logical) {
    return { name, type: "logical", values: cells.map((c) => (isBlank(c) ? null : cellToBool(c))), raw };
  }
  const dates = nonBlank.length > 0 && nonBlank.every(isDateCell);
  if (dates) {
    return { name, type: "date", values: cells.map((c) => (isBlank(c) ? null : parseDateToSerial(String(c)))), raw };
  }
  return { name, type: "string", values: cells.map((c) => (isBlank(c) ? null : String(c).trim())), raw };
}

/** Build a Frame from a header row + body rows of raw cells (CSV import). */
export function frameFromCells(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<unknown>>): FrameValue {
  const ncols = Math.max(headers.length, rows.reduce((m, r) => Math.max(m, r.length), 0));
  const names = makeHeaders(headers, ncols);
  const columns = names.map((name, j) => inferColumn(name, rows.map((r) => r[j] ?? null)));
  return { __frame: true, columns };
}

/** Build a Frame from JSON array-of-records (keys = columns, ordered union). */
export function frameFromRecords(records: ReadonlyArray<Record<string, unknown>>): FrameValue {
  const keys: string[] = [];
  for (const rec of records) for (const k of Object.keys(rec)) if (!keys.includes(k)) keys.push(k);
  const names = makeHeaders(keys, keys.length);
  const columns = keys.map((key, j) => inferColumn(names[j], records.map((r) => r[key])));
  return { __frame: true, columns };
}

/** Build a Frame from JSON array-of-arrays (positional columns). */
export function frameFromRows(rows: ReadonlyArray<ReadonlyArray<unknown>>, headers?: ReadonlyArray<string>): FrameValue {
  const ncols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const names = makeHeaders(headers ?? [], ncols);
  const columns = names.map((name, j) => inferColumn(name, rows.map((r) => r[j])));
  return { __frame: true, columns };
}

// ─── Cube: the recursive container (lattice supremum) ─────────────────────────
// A Cube generalises a Frame: the same named-column tabular shape, but a cell may
// hold ANY value — a scalar, a list, a matrix, a nested Frame, or another Cube. It
// is the top of the socket lattice (every value widens UP into it; see sockets.ts),
// the universal container that closes the type system. Where a Frame column is
// homogeneous (one FrameColType), a Cube column is heterogeneous by nature, so a
// Cube carries no per-column type — each cell stands on its own. (Lambda is the one
// thing a Cube can't hold: it's a function, not data — the socket lattice keeps
// lambda out of a cube too.)

/** A cube cell: any data value. Recursive — a cell may itself be a Frame or Cube,
 *  a list, or a matrix (an array of cells). */
export type CubeCell = FrameCell | FrameValue | CubeValue | CubeCell[];

export interface CubeColumn {
  name: string;
  /** Cell values, aligned by row index. `null` is an empty cell. */
  cells: CubeCell[];
}

export interface CubeValue {
  /** Brand: lets display / readout robustly detect a cube flowing through an
   *  `any` cable, rather than structurally sniffing it (mirrors FrameValue). */
  readonly __cube: true;
  columns: CubeColumn[];
  /** Cached cube-nesting depth: a flat cube (no cube-valued cell) is 1; a cube
   *  holding a cube is 2; and so on. Counts CUBE nesting ONLY — a nested Frame is
   *  a leaf container (its own cells are flat, it can't nest further), so it adds
   *  no depth; only a cube-in-a-cube creates the unbounded drill-in the popup
   *  warns about. We let recursion stay legal and make depth VISIBLE instead of
   *  capping it (the Power Query stance). Computed once at construction — values
   *  are immutable here — reading each child cube's own cached depth, so it's a
   *  bottom-up O(cells) stamp, never a full re-walk per level. */
  readonly depth: number;
}

export function isCubeValue(v: unknown): v is CubeValue {
  return typeof v === "object" && v !== null && (v as Partial<CubeValue>).__cube === true;
}

/** Cube-nesting contributed by a single cell: a cube cell adds its own cached
 *  depth; a list / matrix cell is fanned through (it may itself hold a cube);
 *  everything else (scalar, null, error, leaf Frame) contributes nothing. */
function cellCubeDepth(cell: CubeCell): number {
  if (isCubeValue(cell)) return cell.depth;
  if (Array.isArray(cell)) return cell.reduce<number>((m, c) => Math.max(m, cellCubeDepth(c)), 0);
  return 0;
}

/** A cube's depth = 1 + the deepest cube sitting in any of its cells (0 if none). */
function computeCubeDepth(columns: ReadonlyArray<CubeColumn>): number {
  let inner = 0;
  for (const col of columns) for (const cell of col.cells) inner = Math.max(inner, cellCubeDepth(cell));
  return 1 + inner;
}

/** The single place a CubeValue is born — stamps the brand + the cached depth, so
 *  the depth invariant can't drift. (TS makes `depth` required, so any inline
 *  `{ __cube: true, … }` is a compile error: everything must come through here.) */
function makeCube(columns: CubeColumn[]): CubeValue {
  return { __cube: true, columns, depth: computeCubeDepth(columns) };
}

/** A cube's drill-in depth (cached at construction). Flat cube = 1, cube-in-cube
 *  = 2, and so on — what the table popup surfaces so nesting is never hidden. */
export function cubeDepth(c: CubeValue): number {
  return c.depth;
}

/** Row count = the longest column (columns may differ in length). */
export function cubeRowCount(c: CubeValue): number {
  return c.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
}

/** A Frame is a Cube of flat cells — re-brand each column, cells unchanged. The
 *  trivial widening (a frame's cells are already scalars), so depth is always 1. */
export function frameToCube(f: FrameValue): CubeValue {
  return makeCube(f.columns.map((col) => ({ name: col.name, cells: [...col.values] })));
}

/** Build a Cube from a row-major grid of arbitrary cells + optional headers.
 *  Ragged rows pad short with `null`, like the frame builders. */
export function cubeFromRows(
  rows: ReadonlyArray<ReadonlyArray<CubeCell>>,
  headers?: ReadonlyArray<string>,
): CubeValue {
  const ncols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const names = makeHeaders(headers ?? [], ncols);
  return makeCube(names.map((name, j) => ({ name, cells: rows.map((r) => (j < r.length ? r[j] : null)) })));
}

/** Build a Cube from named columns of arbitrary cells (the general constructor). */
export function cubeFromColumns(cols: ReadonlyArray<{ name?: string; cells: CubeCell[] }>): CubeValue {
  const names = makeHeaders(cols.map((c) => c.name ?? ""), cols.length);
  return makeCube(names.map((name, j) => ({ name, cells: cols[j].cells })));
}

/** Widen any incoming value into a Cube — the runtime side of "everything flows up
 *  into the supremum" (mirrors the frame widening in coerceInputs). A cube passes
 *  through; a frame re-brands its flat cells; a 2-D matrix → a grid of cells; a 1-D
 *  list → a single ROW; a scalar → 1×1. */
export function toCube(v: unknown): CubeValue {
  if (isCubeValue(v)) return v;
  if (isFrameValue(v)) return frameToCube(v);
  if (Array.isArray(v)) {
    return Array.isArray((v as unknown[])[0])
      ? cubeFromRows(v as CubeCell[][])
      : cubeFromRows([v as CubeCell[]]);
  }
  return cubeFromRows([[v as CubeCell]]);
}

// ─── Relate: nest two frames into a cube (the relational producer) ─────────────
// The everyday way a cube is born from normalized tables: keep Customers and
// Orders as separate flat frames, RELATE them on a shared key, and each parent
// row gains a nested-frame cell of its matching child rows. tidyr's nest_join /
// Power Query "merge, leave collapsed". A left-style nest: every parent row is
// kept; a parent with no matches gets an empty (0-row) sub-frame, structure
// preserved. The output is depth 1 (its cells are frames, which are leaves -- only
// a cube-in-a-cube grows depth). Both inputs are frames, so Relate makes ONE level
// of nesting; deeper cubes come from wrapping a cube in a Build Cube cell. (A
// future cube-aware Relate mode could chain Customer -> Order -> LineItem.)

/** Stable equality id for a key cell, so number/text/logical keys match by value
 *  (a logical aligns to 1/0, the same coercion splitFrame uses). */
function keyId(v: FrameCell): string {
  if (v === null || v === undefined) return "~null";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (isSolError(v)) return "~err:" + v.code;
  return String(v);
}

/** A frame of just the given row indices (columns + types + units preserved). */
function subFrame(child: FrameValue, rowIdxs: number[]): FrameValue {
  return {
    __frame: true,
    columns: child.columns.map((c) => ({
      name: c.name,
      type: c.type,
      ...(c.unit ? { unit: c.unit } : {}),
      values: rowIdxs.map((i) => c.values[i] ?? null),
      ...(c.raw ? { raw: rowIdxs.map((i) => c.raw![i] ?? "") } : {}),
    })),
  };
}

/** Relate a parent + child frame on a shared key column into a Cube: the parent's
 *  columns flow through as flat cells, plus one NESTED column whose every cell is
 *  the sub-frame of child rows matching that parent row's key. `null` if either
 *  frame is missing the key column. */
export function relateFramesToCube(
  parent: FrameValue,
  child: FrameValue,
  key: string,
  nestedName: string,
): CubeValue | null {
  const pKey = getColumn(parent, key);
  const cKey = getColumn(child, key);
  if (!pKey || !cKey) return null;

  // Index child rows by key value.
  const childByKey = new Map<string, number[]>();
  const cRows = frameRowCount(child);
  for (let i = 0; i < cRows; i++) {
    const id = keyId(cKey.values[i] ?? null);
    const arr = childByKey.get(id);
    if (arr) arr.push(i);
    else childByKey.set(id, [i]);
  }

  const pRows = frameRowCount(parent);
  // Dedupe the nested column's name against the parent's column names.
  const names = makeHeaders(
    [...parent.columns.map((c) => c.name), nestedName.trim() || "items"],
    parent.columns.length + 1,
  );
  const columns: CubeColumn[] = parent.columns.map((c, j) => ({
    name: names[j],
    cells: Array.from({ length: pRows }, (_, i) => c.values[i] ?? null),
  }));
  const nestedCells: CubeCell[] = Array.from({ length: pRows }, (_, i) =>
    subFrame(child, childByKey.get(keyId(pKey.values[i] ?? null)) ?? []),
  );
  columns.push({ name: names[parent.columns.length], cells: nestedCells });
  return makeCube(columns);
}

/** Cube-aware nest join: descend into a cube parent's nested sub-table column and
 *  nest-join `child` into each leaf FRAME (a leaf frame → a cube), recursing through
 *  already-nested cubes so a chain (Customer → Order → LineItem) deepens by ONE level
 *  per call. The nested column is auto-detected as the FIRST column whose cells hold a
 *  frame/cube (a nest-join cube has exactly one; a hand-built Build-Cube could have
 *  several — we deepen the first deterministically rather than silently the last). A
 *  leaf frame missing the key stays a frame; a parent with no nested column is
 *  returned unchanged. */
export function relateCubeToFrame(parent: CubeValue, child: FrameValue, key: string, nestedName: string): CubeValue {
  let nestedIdx = -1;
  for (let j = 0; j < parent.columns.length; j++) {
    if (parent.columns[j].cells.some((c) => isFrameValue(c) || isCubeValue(c))) { nestedIdx = j; break; }
  }
  if (nestedIdx < 0) return parent;
  const newCells: CubeCell[] = parent.columns[nestedIdx].cells.map((cell) =>
    isCubeValue(cell) ? relateCubeToFrame(cell, child, key, nestedName)
    : isFrameValue(cell) ? (relateFramesToCube(cell, child, key, nestedName) ?? cell)
    : cell,
  );
  return makeCube(parent.columns.map((c, j) => (j === nestedIdx ? { name: c.name, cells: newCells } : c)));
}

/** Interpret one wired value as a CUBE COLUMN's cells (the multi-column Build Cube):
 *  a list → its elements; a single-column cube → that column's cells (pipe a cell-wise
 *  Build Cube straight in); a frame/matrix/scalar → ONE cell holding it; null → empty. */
export function cubeColumnFromValue(value: unknown): CubeCell[] {
  if (value == null) return [];
  if (isCubeValue(value)) return [...(value.columns[0]?.cells ?? [])];
  if (isFrameValue(value)) return [value as CubeCell]; // a whole frame is one cell
  if (Array.isArray(value)) return value as CubeCell[];
  return [value as CubeCell];
}

/** Build a Frame from a columnar object { col: [values] } (or scalars). */
export function frameFromColumnar(obj: Record<string, unknown>): FrameValue {
  const keys = Object.keys(obj);
  const names = makeHeaders(keys, keys.length);
  const columns = keys.map((key, j) => {
    const v = obj[key];
    return inferColumn(names[j], Array.isArray(v) ? v : [v]);
  });
  return { __frame: true, columns };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

/** Row-major grid of cell values for the popup / preview. null → ""; a logical
 *  cell → "TRUE"/"FALSE" string; a per-cell error passes through (the popup renders
 *  its code). Numbers/text pass through unchanged. */
export function frameToGrid(f: FrameValue): (number | string | SolError)[][] {
  const rows = frameRowCount(f);
  return Array.from({ length: rows }, (_, i) =>
    f.columns.map((c) => {
      const v = c.values[i];
      if (v === null || v === undefined) return "";
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      return v; // number | string | SolError
    }),
  );
}
