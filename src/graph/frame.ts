import { parseCsvRows } from "./csv";
import { parseDateToSerial, parseDate, formatDateSerial, DEFAULT_DATE_FORMAT } from "./nodes/dateSerial";
import { isSolError, type SolError } from "./errorValue";
import { coerceLogical } from "./valueKinds";
import { type ColumnUnit, type UnitCell, isUnitCell } from "./unitValue";
import { formatDim, dimEqual, type Dim } from "./dimension";
import { parseColumnUnitFromHeader, columnUnitFromSpec, tagFrameCellUnit, matrixCellsFromList } from "./unitColumn";
import { displayMagnitudeOf } from "./unitBridge";
import { elementFamilyOf, type SocketDataType } from "./sockets";
import type { FormatAnnotation } from "./formatAnnotationStore";

// A date column stores Excel serials — the `type: "date"` tag is the only signal
// those numbers are dates.
export type FrameColType = "number" | "string" | "date" | "logical";

export type FrameCell = number | string | boolean | null | SolError;

export interface FrameColumn {
  name: string;
  type: FrameColType;
  /** Cell values, aligned by row index. `null` is an empty cell. */
  values: FrameCell[];
  /** A numeric column LOCKED to a dimensional unit: cells stay bare AS-TYPED
   *  magnitudes (the display unit's, NOT base-SI — `tagFrameCellUnit` converts). */
  unit?: ColumnUnit;
  /** The DISPLAY format riding downstream from the node that picked it, stamped at
   *  the producer (`coerceInputs`); never serialized, and a nearer pick overrides. */
  format?: FormatAnnotation;
  /** The INPUTTED source text per cell, BEFORE type inference rewrote it. Present
   *  only on SOURCE frames; a computed/transformed column drops it. */
  raw?: string[];
}

export interface FrameValue {
  /** Brand: detects a frame flowing through an `any` cable without structural sniffing. */
  readonly __frame: true;
  columns: FrameColumn[];
  /** Set ONLY on a head-N preview: the TRUE total row count, so the chip can show
   *  "12,400×N" while only N rows are materialized. Absent on a full frame. */
  __totalRows?: number;
  /** The lazy handle a preview was collected from, so Copy CSV never silently
   *  exports the head-N preview as the table. Structurally typed (not FrameRef)
   *  to avoid a frame ↔ frameBackend cycle. */
  __ref?: { readonly __frameRef: string };
  /** Set ONLY on an aggregate over a sketch-mode SAMPLE: sum/count columns were
   *  scaled by `factor`, so the value must never be presented as an exact count. */
  __approx?: { readonly factor: number };
}

export function isFrameValue(v: unknown): v is FrameValue {
  return typeof v === "object" && v !== null && (v as Partial<FrameValue>).__frame === true;
}

/** Row count = the longest column (columns may differ in length after edits). */
export function frameRowCount(f: FrameValue): number {
  return f.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
}

// ─── Header naming ────────────────────────────────────────────────────────────
/** Exactly `ncols` unique names; blanks become `Col{i+1}`, duplicates take the
 *  smallest free integer suffix from 2 (Date, Name, Date → Date, Name, Date2). */
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

/** Numeric Frame from a row-major matrix + header list; a `Name (unit)` header
 *  strips the parenthetical and LOCKS that column to the unit. */
export function buildFrame(matrix: number[][], names?: ReadonlyArray<string>): FrameValue {
  const ncols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
  // Parse header units BEFORE dedup so makeHeaders de-duplicates the clean name.
  const parsed = (names ?? []).map((n) => parseColumnUnitFromHeader(n));
  const cleanNames = (names ?? []).map((_, i) => parsed[i]?.clean ?? names![i]);
  const headers = makeHeaders(cleanNames, ncols);
  const columns: FrameColumn[] = headers.map((name, j) => ({
    name,
    type: "number" as const,
    values: matrix.map((row) => (row[j] === undefined ? null : row[j])),
    ...(parsed[j]?.unit ? { unit: parsed[j]!.unit } : {}),
  }));
  return { __frame: true, columns };
}

/** One frame column from raw cells. `knownType` (from an adopted socket) wins — the
 *  ONLY way to recover `date`; without it the type is inferred type-PRESERVINGLY from
 *  runtime cell types ("1" the string stays a string, unlike CSV's inferColumn). */
export function typedColumn(
  name: string,
  cells: ReadonlyArray<unknown>,
  length: number,
  knownType?: FrameColType | null,
): FrameColumn {
  const present = cells.filter((c) => c !== null && c !== undefined && !isSolError(c));
  const type: FrameColType = knownType
    ?? (present.length > 0 && present.every((c) => typeof c === "number") ? "number"
      : present.length > 0 && present.every((c) => typeof c === "boolean") ? "logical"
      : "string");
  const values: FrameCell[] = [];
  for (let i = 0; i < length; i++) {
    const c = cells[i];
    if (c === null || c === undefined) { values.push(null); continue; }
    if (isSolError(c)) { values.push(c); continue; }
    if (type === "string") { values.push(typeof c === "string" ? c : String(c)); continue; }
    if (type === "logical") { values.push(typeof c === "boolean" ? c : cellToBool(c)); continue; }
    values.push(typeof c === "number" ? c : (cellToNumber(c) ?? NaN));
  }
  return { name, type, values };
}

/** `colType` (the matrix's homogeneous element family) applies to all columns; null
 *  ⇒ inferred per column. Header `(unit)` suffixes lock a numeric column's unit. */
export function buildFrameTyped(
  matrix: ReadonlyArray<ReadonlyArray<unknown>>,
  names?: ReadonlyArray<string>,
  colType?: FrameColType | null,
): FrameValue {
  const ncols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
  const parsed = (names ?? []).map((n) => parseColumnUnitFromHeader(n));
  const cleanNames = (names ?? []).map((_, i) => parsed[i]?.clean ?? names![i]);
  const headers = makeHeaders(cleanNames, ncols);
  const columns: FrameColumn[] = headers.map((name, j) => {
    const cells = matrix.map((row) => (j < row.length ? row[j] : null));
    const col = typedColumn(name, cells, matrix.length, colType ?? undefined);
    return parsed[j]?.unit && col.type === "number" ? { ...col, unit: parsed[j]!.unit } : col;
  });
  return { __frame: true, columns };
}

/** Socket dataType → frame column type; null when unknowable (a wildcard rung or
 *  `complex`), on which callers fall back to value inference. */
export function colTypeForSocket(dataType: string | undefined): FrameColType | null {
  switch (elementFamilyOf(dataType as SocketDataType)) {
    case "number": return "number";
    case "string": return "string";
    case "date": return "date";
    case "logical": return "logical";
    default: return null;
  }
}

/** The Matrix is all-or-nothing — null when any column is text; the header list is
 *  always the complete set of column names, mixed or not. */
export function splitFrame(f: FrameValue): { matrix: number[][] | null; headers: string[] } {
  const headers = f.columns.map((c) => c.name);
  if (frameHasTextColumns(f)) return { matrix: null, headers };
  const rows = frameRowCount(f);
  const matrix: number[][] = Array.from({ length: rows }, (_, i) =>
    f.columns.map((c) => {
      const v = c.values[i];
      if (typeof v === "number") return v;
      if (typeof v === "boolean") return v ? 1 : 0;
      return NaN;
    }),
  );
  return { matrix, headers };
}

/** Date columns hold serials, so they DON'T block the numeric matrix — only
 *  genuine string columns do. */
export function frameHasTextColumns(f: FrameValue): boolean {
  return f.columns.some((c) => c.type === "string");
}

/** Format one cell for DISPLAY by column type (serials → date strings, booleans →
 *  TRUE/FALSE, errors → #CODE!); the popup editor uses raw `values` so editing stays
 *  literal. */
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

/** Append, or replace when the name already exists; de-dupes the name on append. */
export function addColumn(
  f: FrameValue,
  name: string,
  values: FrameCell[],
  type: FrameColType = "number",
): FrameValue {
  const { clean, unit } = parseColumnUnitFromHeader(name);
  const unitTag = unit && type === "number" ? { unit } : {};
  const existingIdx = f.columns.findIndex((c) => c.name === clean.trim());
  if (existingIdx >= 0) {
    const columns = f.columns.map((c, i) =>
      i === existingIdx ? { ...c, type, values, raw: undefined, ...unitTag } : c, // replaced data is computed — no source text
    );
    return { __frame: true, columns };
  }
  const others = f.columns.map((c) => c.name);
  const [finalName] = makeHeaders([...others, clean], others.length + 1).slice(-1);
  return { __frame: true, columns: [...f.columns, { name: finalName, type, values, ...unitTag }] };
}

// ─── Frame Input (editable in-node LITERAL source) ──────────────────────────────
// The stored text is never rewritten; the typed FrameValue flowing downstream is
// DERIVED from it at compute time (deriveFrame).

/** A column of the editable source; `cells` is the RAW text typed, never coerced. */
export interface FrameSourceColumn {
  name: string;
  type: FrameColType;
  cells: string[];
  /** An FC unit id tagged on the column at the source; `deriveFrame` applies it to
   *  `FrameColumn.unit` so the unit rides the value downstream. */
  unit?: string;
  /** COMPUTED column: the key of the λ input defining it — present ⇒ cells derive
   *  per row and the raw `cells` are ignored. */
  lambda?: string;
  /** COMPUTED column, inline row-wise formula — the CC node's expr rules verbatim
   *  (tableRefSemantics); a `lambda` binding wins when both are set. */
  expr?: string;
}
export type FrameSource = FrameSourceColumn[];

/** Coerce ONE raw cell to its typed value — the value boundary. Blank → null; a
 *  string keeps its text verbatim; logical goes through the shared coerceLogical. */
export function coerceFrameCell(type: FrameColType, raw: string): FrameCell {
  if (type === "string") return raw === "" ? null : raw;
  const s = raw.trim();
  if (s === "") return null;
  if (type === "logical") return coerceLogical(s);
  const n = cellToNumber(s);
  if (n !== null) return n;
  if (type === "date") { const r = parseDate(s); if (isSolError(r)) return r; return Number.isFinite(r) ? r : NaN; }
  return NaN;
}

/** Derive the typed FrameValue from the raw source; the raw cells ride along as
 *  `raw` so a read-only viewer still shows the literal source. */
export function deriveFrame(source: FrameSource): FrameValue {
  return {
    __frame: true,
    columns: source.map((c) => ({
      name: c.name,
      type: c.type,
      values: c.cells.map((cell) => coerceFrameCell(c.type, cell)),
      raw: c.cells,
      ...(c.type === "number" && c.unit ? { unit: columnUnitFromSpec(c.unit) ?? undefined } : {}),
    })),
  };
}

/** Serialize the raw source to the stored `frameText` (JSON). */
export function frameSourceToText(source: FrameSource): string {
  return JSON.stringify(source.map((c) => ({
    name: c.name, type: c.type, cells: c.cells,
    ...(c.unit ? { unit: c.unit } : {}),
    ...(c.lambda ? { lambda: c.lambda } : {}),
    ...(c.expr ? { expr: c.expr } : {}),
  })));
}

/** Type only (cells kept raw): all-numeric → number; else all-TRUE/FALSE → logical;
 *  else all-ISO → date; else text. */
function inferColType(cells: ReadonlyArray<string>): FrameColType {
  const nonBlank = cells.filter((c) => !isBlank(c));
  if (nonBlank.length === 0) return "string";
  if (nonBlank.every((c) => cellToNumber(c) !== null)) return "number";
  if (nonBlank.every(isLogicalCell)) return "logical";
  if (nonBlank.every(isDateCell)) return "date";
  return "string";
}

/** Parse stored `frameText` → the raw editable source. JSON `cells` reads directly;
 *  a typed-`values` JSON is stringified back to raw cells; anything else is the
 *  hand-typed / legacy CSV, typed by inference with the text kept exact. */
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
          const unit = typeof c?.unit === "string" && c.unit !== "" ? c.unit : undefined;
          const lambda = typeof c?.lambda === "string" && c.lambda !== "" ? c.lambda : undefined;
          const expr = typeof c?.expr === "string" && c.expr.trim() !== "" ? c.expr : undefined;
          return { name: names[i], type, cells, unit, ...(lambda ? { lambda } : {}), ...(expr ? { expr } : {}) };
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

/** Serialize typed columns to the stored form, for callers holding a typed Frame. */
export function frameColumnsToInputText(columns: ReadonlyArray<FrameColumn>): string {
  return JSON.stringify(columns.map((c) => ({ name: c.name, type: c.type, values: c.values })));
}

/** The typed FrameValue from stored text — derive ∘ parse. */
export function frameFromInputText(text: string): FrameValue {
  return deriveFrame(parseFrameSource(text));
}


/** Honors the headers even when the body has fewer columns or no rows — buildFrame
 *  takes ncols from the matrix alone and would drop named-but-empty columns. */
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

function cellToNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // A cube cell may be a dimensioned `UnitCell` — read its DISPLAY magnitude, per
  // the unit-blind boundary.
  if (isUnitCell(v)) { const m = displayMagnitudeOf(v); return Number.isFinite(m) ? m : null; }
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    // Strip commas ONLY in genuine thousands positions: a blanket strip reads the
    // European decimal comma "3,5" as 35.
    const grouped = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t);
    const n = Number(grouped ? t.replace(/,/g, "") : t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

// ONLY unambiguous ISO-ish forms, so bare years and locale-ambiguous "1/2/26" are
// never mistaken for dates (Get Column read-as Date converts the rest explicitly).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
function isDateCell(v: unknown): boolean {
  return typeof v === "string" && ISO_DATE.test(v.trim()) && Number.isFinite(parseDateToSerial(v));
}

// TRUE/FALSE literals only, so a numeric 0/1 mask column stays numeric.
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

/** Numeric → number; else all-TRUE/FALSE → logical; else unambiguous ISO → date
 *  (serials); else text. Numeric runs first so a 0/1 mask stays numeric. */
export function inferColumn(name: string, cells: ReadonlyArray<unknown>): FrameColumn {
  // Cube cells carry units per-cell (unitGranularity): recover the uniform unit and unwrap to
  // magnitudes before inference, so a frame→cube→frame round trip keeps units.
  let recovered: ColumnUnit | undefined;
  if (cells.some(isUnitCell)) {
    const { mags, unit } = matrixCellsFromList(cells);
    cells = mags;
    recovered = unit;
  }
  // Source text per cell, kept so the editor's Source view shows what came in;
  // a blank → "", aligned with the null value.
  const raw = cells.map((c) => (isBlank(c) ? "" : String(c).trim()));
  const nonBlank = cells.filter((c) => !isBlank(c));
  const numeric = nonBlank.length > 0 && nonBlank.every((c) => cellToNumber(c) !== null);
  if (numeric) {
    return { name, type: "number", values: cells.map((c) => (isBlank(c) ? null : cellToNumber(c))), raw, ...(recovered ? { unit: recovered } : {}) };
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

/** Any data value, recursively. A cube is heterogeneous PER CELL (unitGranularity), so a
 *  dimensioned cell carries its unit AS A VALUE — a base-SI `UnitCell`. */
export type CubeCell = FrameCell | FrameValue | CubeValue | UnitCell | CubeCell[];

export interface CubeColumn {
  name: string;
  /** Cell values, aligned by row index. `null` is an empty cell. */
  cells: CubeCell[];
  /** OPTIONAL element type carried from a source frame column, so a flat cube still
   *  renders dates/logicals. A DISPLAY hint, not a homogeneity guarantee. */
  type?: FrameColType;
}

export interface CubeValue {
  /** Brand: detects a cube flowing through an `any` cable without structural sniffing. */
  readonly __cube: true;
  columns: CubeColumn[];
  /** Cached CUBE-nesting depth (a nested Frame is a leaf and adds none), stamped at
   *  construction from each child's cached depth — bottom-up O(cells), never a re-walk. */
  readonly depth: number;
}

export function isCubeValue(v: unknown): v is CubeValue {
  return typeof v === "object" && v !== null && (v as Partial<CubeValue>).__cube === true;
}

/** A cube cell adds its cached depth; a list / matrix cell is fanned through;
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

/** The single place a CubeValue is born — `depth` is required, so any inline
 *  `{ __cube: true, … }` is a compile error. */
function makeCube(columns: CubeColumn[]): CubeValue {
  return { __cube: true, columns, depth: computeCubeDepth(columns) };
}

/** A cube's drill-in depth: flat = 1, cube-in-cube = 2, and so on. */
export function cubeDepth(c: CubeValue): number {
  return c.depth;
}

/** Row count = the longest column (columns may differ in length). */
export function cubeRowCount(c: CubeValue): number {
  return c.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
}

/** The single frame→cube unit bridge — every flattening path routes through it: a
 *  unit-locked column's cells become per-cell base-SI `UnitCell`s (unitGranularity). */
export function cubeCellsFromColumn(col: FrameColumn): CubeCell[] {
  return col.unit
    ? col.values.map((v) => tagFrameCellUnit(v, col.unit!) as CubeCell)
    : [...col.values];
}

/** A Frame is a Cube of flat cells — element TYPE carried, unit-locked cells tagged;
 *  depth is always 1. */
export function frameToCube(f: FrameValue): CubeValue {
  return makeCube(f.columns.map((col) => ({ name: col.name, type: col.type, cells: cubeCellsFromColumn(col) })));
}

/** Cube from a row-major grid + optional headers; ragged rows pad short with `null`. */
export function cubeFromRows(
  rows: ReadonlyArray<ReadonlyArray<CubeCell>>,
  headers?: ReadonlyArray<string>,
): CubeValue {
  const ncols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const names = makeHeaders(headers ?? [], ncols);
  return makeCube(names.map((name, j) => ({ name, cells: rows.map((r) => (j < r.length ? r[j] : null)) })));
}

/** Build a Cube from named columns of arbitrary cells (the general constructor). */
export function cubeFromColumns(cols: ReadonlyArray<{ name?: string; cells: CubeCell[]; type?: FrameColType }>): CubeValue {
  const names = makeHeaders(cols.map((c) => c.name ?? ""), cols.length);
  return makeCube(names.map((name, j) => ({ name, cells: cols[j].cells, ...(cols[j].type ? { type: cols[j].type } : {}) })));
}

/** Widen any value into a Cube (mirrors the frame widening in coerceInputs): a 2-D
 *  matrix → a grid, a 1-D list → a single ROW, a scalar → 1×1. */
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

/** Dimension symbol + BASE-SI magnitude, so `5 km` == `5000 m` but ≠ `5 kg` ≠ bare
 *  `5`; currency's identity is its display CODE (no FX), so $5 ≠ 5€. */
function dimKeyId(base: number, dim: Dim, display: string | undefined): string {
  const cur = dimEqual(dim, { currency: 1 }) ? (display ?? "") : "";
  return `~u:${formatDim(dim)}${cur ? `:${cur}` : ""}:${String(base)}`;
}

/** Stable equality id for a key cell (a logical aligns to 1/0, as splitFrame
 *  coerces); a pure ratio is dimensionless and keys as its bare magnitude. */
function keyId(v: FrameCell | UnitCell): string {
  if (v === null || v === undefined) return "~null";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (isSolError(v)) return "~err:" + v.code;
  if (isUnitCell(v)) return v.ratio ? String(v.value) : dimKeyId(v.value, v.dim, v.display);
  return String(v);
}

/** `keyId` for a COLUMN-united column: bare base-SI cells key dimensioned, matching
 *  a per-cell `UnitCell` of the same quantity. */
function keyIdInColumn(v: FrameCell, unit: ColumnUnit | undefined): string {
  if (unit && typeof v === "number" && Number.isFinite(v)) return dimKeyId(v, unit.dim, unit.display);
  return keyId(v);
}

/** Key id for a CUBE cell; a nested frame/cube/list cell can't be a join key
 *  (→ null, unmatched). */
function cellKeyId(cell: CubeCell, unit?: ColumnUnit): string | null {
  if (cell === null) return keyId(null);
  if (typeof cell === "number" || typeof cell === "string" || typeof cell === "boolean") return keyIdInColumn(cell as FrameCell, unit);
  if (isSolError(cell)) return keyId(cell);
  if (isUnitCell(cell)) return keyId(cell);
  return null;
}

/** A frame of just the given row indices (columns + types + units preserved). */
function subFrame(child: FrameValue, rowIdxs: number[]): FrameValue {
  return {
    __frame: true,
    columns: child.columns.map((c) => ({
      name: c.name,
      type: c.type,
      ...(c.unit ? { unit: c.unit } : {}),
      ...(c.format ? { format: c.format } : {}),
      values: rowIdxs.map((i) => c.values[i] ?? null),
      ...(c.raw ? { raw: rowIdxs.map((i) => c.raw![i] ?? "") } : {}),
    })),
  };
}

/** Row subset of a cube — the `subFrame` analogue, so a pre-built cube keeps its
 *  own nesting when nested. */
function subCube(child: CubeValue, rowIdxs: number[]): CubeValue {
  return makeCube(child.columns.map((c) => ({
    name: c.name,
    ...(c.type ? { type: c.type } : {}),
    cells: rowIdxs.map((i) => c.cells[i] ?? null),
  })));
}

/** Relate parent + child on a shared key into a Cube: one NESTED column whose cells
 *  are the sub-frames of matching child rows. `null` if either lacks the key. */
export function relateFramesToCube(
  parent: FrameValue,
  child: FrameValue | CubeValue,
  key: string,
  nestedName: string,
): CubeValue | null {
  const pKey = getColumn(parent, key);
  if (!pKey) return null;
  const cKeyCol = isCubeValue(child) ? null : getColumn(child, key);
  const cKeyCells: readonly CubeCell[] | null = isCubeValue(child)
    ? (child.columns.find((c) => c.name === key)?.cells ?? null)
    : (cKeyCol?.values ?? null);
  if (!cKeyCells) return null;
  const cRows = isCubeValue(child) ? cubeRowCount(child) : frameRowCount(child);

  // A frame child's COLUMN unit dimensions its bare cells (cube cells carry their own).
  const childByKey = new Map<string, number[]>();
  for (let i = 0; i < cRows; i++) {
    const id = cellKeyId(cKeyCells[i] ?? null, cKeyCol?.unit);
    if (id === null) continue;
    const arr = childByKey.get(id);
    if (arr) arr.push(i);
    else childByKey.set(id, [i]);
  }

  const pRows = frameRowCount(parent);
  const names = makeHeaders(
    [...parent.columns.map((c) => c.name), nestedName.trim() || "items"],
    parent.columns.length + 1,
  );
  const columns: CubeColumn[] = parent.columns.map((c, j) => {
    const cells = cubeCellsFromColumn(c);
    return { name: names[j], type: c.type, cells: Array.from({ length: pRows }, (_, i) => cells[i] ?? null) };
  });
  const nestedCells: CubeCell[] = Array.from({ length: pRows }, (_, i) => {
    const idxs = childByKey.get(keyIdInColumn(pKey.values[i] ?? null, pKey.unit)) ?? [];
    return isCubeValue(child) ? subCube(child, idxs) : subFrame(child, idxs);
  });
  columns.push({ name: names[parent.columns.length], cells: nestedCells });
  return makeCube(columns);
}

/** Cube-aware nest join: recurses through nested cubes so a chain deepens by ONE
 *  level per call. The nested column is the FIRST column holding a frame/cube —
 *  deterministic when a hand-built cube has several. */
export function relateCubeToFrame(parent: CubeValue, child: FrameValue | CubeValue, key: string, nestedName: string): CubeValue {
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
  if (isFrameValue(value)) return [value as CubeCell];
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

/** Row-major grid for the popup / preview: null → "", a logical → "TRUE"/"FALSE",
 *  a per-cell error passes through. */
export function frameToGrid(f: FrameValue): (number | string | SolError)[][] {
  const rows = frameRowCount(f);
  return Array.from({ length: rows }, (_, i) =>
    f.columns.map((c) => {
      const v = c.values[i];
      if (v === null || v === undefined) return "";
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      return v;
    }),
  );
}
