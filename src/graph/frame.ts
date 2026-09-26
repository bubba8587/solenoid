// [[C24]] arraySemantics, [[C44]] dateSerials, [[D43]] unitByGranularity
import { parseCsvRows } from "./csv";
import { parseDateToSerial, parseDate, formatDateSerial, DEFAULT_DATE_FORMAT } from "./nodes/dateSerial";
import { isSolError, solError, type SolError } from "./errorValue";
import { coerceLogical, decimalFromText } from "./valueKinds";
import { type ColumnUnit, type UnitCell, isUnitCell } from "./unitValue";
import { formatDim, dimEqual, type Dim } from "./dimension";
import { parseColumnUnitFromHeader, columnUnitFromSpec, tagFrameCellUnit, matrixCellsFromList } from "./unitColumn";
import { displayMagnitudeOf, fcUnitToUnit } from "./unitBridge";
import { elementFamilyOf, type SocketDataType } from "./sockets";
import { dateAnnotationPattern, type FormatAnnotation } from "./formatAnnotationStore";

export type FrameColType = "number" | "string" | "date" | "logical";

export type FrameCell = number | string | boolean | null | SolError;

export interface FrameColumn {
  name: string;
  type: FrameColType;
  values: FrameCell[];
  unit?: ColumnUnit;
  format?: FormatAnnotation;
  raw?: string[];
}

export interface FrameValue {
  readonly __frame: true;
  columns: FrameColumn[];
  __totalRows?: number;
  /** Structurally typed, not `FrameRef`, to avoid a frame ↔ frameBackend import cycle. */
  __ref?: { readonly __frameRef: string };
  __approx?: { readonly factor: number };
}

export function isFrameValue(v: unknown): v is FrameValue {
  return typeof v === "object" && v !== null && (v as Partial<FrameValue>).__frame === true;
}

export function frameRowCount(f: FrameValue): number {
  return f.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
}

// ─── Header naming ────────────────────────────────────────────────────────────
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

export function buildFrame(matrix: number[][], names?: ReadonlyArray<string>): FrameValue {
  const ncols = matrix.reduce((m, r) => Math.max(m, r.length), 0);
  const parsed = (names ?? []).map((n) => parseColumnUnitFromHeader(n));
  const cleanNames = (names ?? []).map((_, i) => parsed[i]?.clean ?? names![i]);
  const headers = makeHeaders(cleanNames, ncols);
  const columns: FrameColumn[] = headers.map((name, j) => ({
    name,
    type: "number" as const,
    values: matrix.map((row) => (row[j] === undefined ? null : row[j])),
    ...(parsed[j]?.unit ? { unit: parsed[j].unit } : {}),
  }));
  return { __frame: true, columns };
}

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
    return parsed[j]?.unit && col.type === "number" ? { ...col, unit: parsed[j].unit } : col;
  });
  return { __frame: true, columns };
}

export function colTypeForSocket(dataType: string | undefined): FrameColType | null {
  switch (elementFamilyOf(dataType as SocketDataType)) {
    case "number": return "number";
    case "string": return "string";
    case "date": return "date";
    case "logical": return "logical";
    default: return null;
  }
}

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

export function frameHasTextColumns(f: FrameValue): boolean {
  return f.columns.some((c) => c.type === "string");
}

export function formatFrameCell(type: FrameColType, v: FrameCell, format?: FormatAnnotation): number | string | null {
  if (isSolError(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (type === "date" && typeof v === "number" && Number.isFinite(v)) {
    const pattern = (format && dateAnnotationPattern(format)) || DEFAULT_DATE_FORMAT;
    return formatDateSerial(v, pattern);
  }
  return v;
}

// ─── Column access ────────────────────────────────────────────────────────────

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
      i === existingIdx ? { ...c, type, values, raw: undefined, ...unitTag } : c,
    );
    return { __frame: true, columns };
  }
  const others = f.columns.map((c) => c.name);
  const [finalName] = makeHeaders([...others, clean], others.length + 1).slice(-1);
  return { __frame: true, columns: [...f.columns, { name: finalName, type, values, ...unitTag }] };
}

// ─── Frame Input (editable in-node LITERAL source) ──────────────────────────────

export interface FrameSourceColumn {
  name: string;
  type: FrameColType;
  cells: string[];
  unit?: string;
  expr?: string;
}
export type FrameSource = FrameSourceColumn[];

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

/** A list item read as a type, as List Input reads one: what the type can't read is blank. Converts, never filters; the caller passes null and per-cell errors through. */
export function coerceListItem(type: FrameColType, v: unknown): FrameCell {
  switch (type) {
    case "number": {
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "string") { const n = decimalFromText(v); return Number.isFinite(n) ? n : null; }
      return null;
    }
    case "date": {
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string") {
        const d = parseDate(v);
        if (isSolError(d)) return d;
        return d !== null && Number.isFinite(d) ? d : null;
      }
      return null;
    }
    case "string":
      if (typeof v === "string") return v;
      return typeof v === "number" || typeof v === "boolean" ? String(v) : null;
    case "logical":
      return coerceLogical(v) as FrameCell;
  }
}

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

export function frameSourceToText(source: FrameSource): string {
  return JSON.stringify(source.map((c) => ({
    name: c.name, type: c.type, cells: c.cells,
    ...(c.unit ? { unit: c.unit } : {}),
    ...(c.expr ? { expr: c.expr } : {}),
  })));
}

function inferColType(cells: ReadonlyArray<string>): FrameColType {
  const nonBlank = cells.filter((c) => !isBlank(c));
  if (nonBlank.length === 0) return "string";
  if (nonBlank.every((c) => cellToNumber(c) !== null)) return "number";
  if (nonBlank.every(isLogicalCell)) return "logical";
  if (nonBlank.every(isDateCell)) return "date";
  return "string";
}

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
            ? (c.cells as unknown[]).map((x) => (x == null ? "" : String(x)))
            : Array.isArray(c?.values)
              ? c.values.map((x) =>
                  x == null ? "" : typeof x === "boolean" ? (x ? "TRUE" : "FALSE") : String(x))
              : [];
          const unit = typeof c?.unit === "string" && c.unit !== "" ? c.unit : undefined;
          const expr = typeof c?.expr === "string" && c.expr.trim() !== "" ? c.expr : undefined;
          return { name: names[i], type, cells, unit, ...(expr ? { expr } : {}) };
        });
      }
    } catch { /* malformed JSON falls through to the CSV reader */ }
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

export function frameColumnsToInputText(columns: ReadonlyArray<FrameColumn>): string {
  return JSON.stringify(columns.map((c) => ({ name: c.name, type: c.type, values: c.values })));
}

export function frameFromInputText(text: string): FrameValue {
  return deriveFrame(parseFrameSource(text));
}


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
  if (isUnitCell(v)) { const m = displayMagnitudeOf(v); return Number.isFinite(m) ? m : null; }
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = decimalFromText(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
function isDateCell(v: unknown): boolean {
  return typeof v === "string" && ISO_DATE.test(v.trim()) && Number.isFinite(parseDateToSerial(v));
}

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

/** A note frame column's type from its YAML cells: one family throughout, else text ([[B17]] typedValueModel). The app and the Obsidian plugin guess with this one. */
export function guessNoteColumnType(values: ReadonlyArray<unknown>, isDate: (v: unknown) => boolean): FrameColType {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (present.length === 0) return "string";
  if (present.every((v) => typeof v === "boolean")) return "logical";
  if (present.every((v) => typeof v === "number")) return "number";
  if (present.every(isDate)) return "date";
  return "string";
}

export function inferColumn(name: string, cells: ReadonlyArray<unknown>): FrameColumn {
  let recovered: ColumnUnit | undefined;
  if (cells.some(isUnitCell)) {
    const { mags, unit } = matrixCellsFromList(cells);
    cells = mags;
    recovered = unit;
  }
  const raw = cells.map((c) => (isSolError(c) ? c.code : isBlank(c) ? "" : String(c).trim()));
  const nonBlank = cells.filter((c) => !isBlank(c) && !isSolError(c));
  const read = (fn: (c: unknown) => FrameCell): FrameCell[] =>
    cells.map((c) => (isSolError(c) ? c : isBlank(c) ? null : fn(c)));
  if (nonBlank.length > 0 && nonBlank.every((c) => typeof c === "boolean")) {
    return { name, type: "logical", values: read((c) => c as boolean), raw };
  }
  const numeric = nonBlank.length > 0 && nonBlank.every((c) => cellToNumber(c) !== null);
  if (numeric) {
    return { name, type: "number", values: read(cellToNumber), raw, ...(recovered ? { unit: recovered } : {}) };
  }
  const logical = nonBlank.length > 0 && nonBlank.every(isLogicalCell);
  if (logical) {
    return { name, type: "logical", values: read(cellToBool), raw };
  }
  const dates = nonBlank.length > 0 && nonBlank.every(isDateCell);
  if (dates) {
    return { name, type: "date", values: read((c) => parseDateToSerial(String(c))), raw };
  }
  return { name, type: "string", values: read((c) => String(c).trim()), raw };
}

/** From column `from` on, and for any column with no type of its own, each column the rows reach takes the type its cells read as; the others keep theirs. */
export function columnTypesAfterCsvEdit(
  types: ReadonlyArray<FrameColType>,
  from: number,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): FrameColType[] {
  const out = types.slice();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (let j = Math.max(0, Math.min(from, out.length)); j < width; j++) {
    out[j] = inferColumn("", rows.map((r) => r[j] ?? "")).type;
  }
  return out;
}

export function frameFromCells(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<unknown>>): FrameValue {
  const ncols = Math.max(headers.length, rows.reduce((m, r) => Math.max(m, r.length), 0));
  const names = makeHeaders(headers, ncols);
  const columns = names.map((name, j) => inferColumn(name, rows.map((r) => r[j] ?? null)));
  return { __frame: true, columns };
}

export function frameFromRecords(records: ReadonlyArray<Record<string, unknown>>): FrameValue {
  const keys: string[] = [];
  for (const rec of records) for (const k of Object.keys(rec)) if (!keys.includes(k)) keys.push(k);
  const names = makeHeaders(keys, keys.length);
  const columns = keys.map((key, j) => inferColumn(names[j], records.map((r) => r[key])));
  return { __frame: true, columns };
}

function pickedCell(type: FrameColType, v: unknown): CubeCell {
  return v == null ? null : coerceFrameCell(type, String(v));
}

const listItemAs = (type: FrameColType, x: unknown): CubeCell =>
  Array.isArray(x) ? x.map((y) => listItemAs(type, y)) : x == null || isSolError(x) ? (x as CubeCell) : isCubeValue(x) || isFrameValue(x) ? typedCubeCell(type, x) : coerceListItem(type, x);

/** A cell read as its column's declared type ([[D80]] cubeColumnTypes): a scalar as a Frame cell is (unreadable is NaN), a list's items as List Input's are (unreadable is blank), and a nested table with every column read the same way. The cells as typed are never changed. */
export function typedCubeCell(type: FrameColType, c: CubeCell): CubeCell {
  if (c == null || isSolError(c)) return c;
  if (Array.isArray(c)) return c.map((x) => listItemAs(type, x));
  if (isCubeValue(c)) return makeCube(c.columns.map((col) => ({ ...col, type, cells: col.cells.map((x) => typedCubeCell(type, x)) })));
  if (isFrameValue(c)) {
    return {
      __frame: true,
      columns: c.columns.map((col) => ({
        name: col.name, type,
        values: col.values.map((v) => (v == null || isSolError(v) ? v : pickedCell(type, v) as FrameCell)),
        ...(type === "number" && col.unit ? { unit: col.unit } : {}),
        ...(col.format ? { format: col.format } : {}),
      })),
    };
  }
  return isUnitCell(c) ? c : pickedCell(type, c);
}

export function recordsToCube(records: ReadonlyArray<Record<string, unknown>>, picks: Readonly<Record<string, FrameColType>> = {}): CubeValue {
  const keys: string[] = [];
  for (const rec of records) for (const k of Object.keys(rec)) if (!keys.includes(k)) keys.push(k);
  const names = makeHeaders(keys, keys.length);
  const toCell = (v: unknown): CubeCell => {
    if (v == null) return null;
    if (Array.isArray(v)) {
      const present = v.filter((x) => x != null);
      const objs = present.filter((x) => typeof x === "object" && !Array.isArray(x));
      if (present.length > 0 && objs.length === present.length) return recordsToCube(v.map((x) => (x ?? {}) as Record<string, unknown>));
      return v.map(toCell);
    }
    if (typeof v === "object") return recordsToCube([v as Record<string, unknown>]);
    return v as FrameCell;
  };
  const pickDeep = (type: FrameColType, c: CubeCell): CubeCell => typedCubeCell(type, c);
  return cubeFromColumns(keys.map((key, j) => {
    const cells = records.map((r) => toCell(r[key]));
    const scalarOnly = cells.every((c) => c == null || (typeof c !== "object"));
    const pick = picks[key];
    if (!scalarOnly) return pick ? { name: names[j], cells: cells.map((c) => pickDeep(pick, c)), type: pick } : { name: names[j], cells };
    if (pick) return { name: names[j], cells: cells.map((c) => pickedCell(pick, c)), type: pick };
    const inferred = inferColumn(names[j], cells);
    return { name: names[j], cells, type: inferred.type };
  }));
}

export function frameFromRows(rows: ReadonlyArray<ReadonlyArray<unknown>>, headers?: ReadonlyArray<string>): FrameValue {
  const ncols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const names = makeHeaders(headers ?? [], ncols);
  const columns = names.map((name, j) => inferColumn(name, rows.map((r) => r[j])));
  return { __frame: true, columns };
}

// ─── Cube: the recursive container (lattice supremum) ─────────────────────────

export type CubeCell = FrameCell | FrameValue | CubeValue | UnitCell | CubeCell[];

export interface CubeColumn {
  name: string;
  cells: CubeCell[];
  type?: FrameColType;
  format?: FormatAnnotation;
}

export interface CubeValue {
  readonly __cube: true;
  columns: CubeColumn[];
  readonly depth: number;
}

export function isCubeValue(v: unknown): v is CubeValue {
  return typeof v === "object" && v !== null && (v as Partial<CubeValue>).__cube === true;
}

function cellCubeDepth(cell: CubeCell): number {
  if (isCubeValue(cell)) return cell.depth;
  if (Array.isArray(cell)) return cell.reduce<number>((m, c) => Math.max(m, cellCubeDepth(c)), 0);
  return 0;
}

function computeCubeDepth(columns: ReadonlyArray<CubeColumn>): number {
  let inner = 0;
  for (const col of columns) for (const cell of col.cells) inner = Math.max(inner, cellCubeDepth(cell));
  return 1 + inner;
}

function makeCube(columns: CubeColumn[]): CubeValue {
  return { __cube: true, columns, depth: computeCubeDepth(columns) };
}

export function cubeDepth(c: CubeValue): number {
  return c.depth;
}

export function cubeRowCount(c: CubeValue): number {
  return c.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
}

export function cubeCellsFromColumn(col: FrameColumn): CubeCell[] {
  return col.unit
    ? col.values.map((v) => tagFrameCellUnit(v, col.unit!) as CubeCell)
    : [...col.values];
}

export function frameToCube(f: FrameValue): CubeValue {
  return makeCube(f.columns.map((col) => ({ name: col.name, type: col.type, ...(col.format ? { format: col.format } : {}), cells: cubeCellsFromColumn(col) })));
}

export function cubeFromRows(
  rows: ReadonlyArray<ReadonlyArray<CubeCell>>,
  headers?: ReadonlyArray<string>,
): CubeValue {
  const ncols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const names = makeHeaders(headers ?? [], ncols);
  return makeCube(names.map((name, j) => ({ name, cells: rows.map((r) => (j < r.length ? r[j] : null)) })));
}

export function cubeFromColumns(cols: ReadonlyArray<{ name?: string; cells: CubeCell[]; type?: FrameColType; format?: FormatAnnotation }>): CubeValue {
  const names = makeHeaders(cols.map((c) => c.name ?? ""), cols.length);
  return makeCube(names.map((name, j) => ({ name, cells: cols[j].cells, ...(cols[j].type ? { type: cols[j].type } : {}), ...(cols[j].format ? { format: cols[j].format } : {}) })));
}

export function flatCubeToFrame(c: CubeValue, only?: readonly string[] | "scalar"): FrameValue | SolError {
  const nested = (col: CubeColumn) => col.cells.some((v) => isCubeValue(v) || isFrameValue(v) || Array.isArray(v));
  let cols: CubeColumn[];
  if (only === "scalar") cols = c.columns.filter((col) => !nested(col));
  else if (only) {
    cols = [];
    for (const name of only) {
      const col = c.columns.find((cc) => cc.name === name);
      if (!col) return solError("#REF!", `column "${name}" not found`);
      if (!cols.includes(col)) cols.push(col);
    }
  } else cols = c.columns;
  for (const col of cols) {
    if (nested(col)) return solError("#SHAPE!", `Column "${col.name}" holds nested cells; this reads flat rows`);
  }
  const rows = cubeRowCount(c);
  return {
    __frame: true,
    columns: cols.map((col) => {
      // Cells in one unit read in it; cells that disagree read as base SI with no unit.
      const { mags, unit } = col.cells.some(isUnitCell) ? matrixCellsFromList(col.cells) : { mags: col.cells, unit: undefined };
      const typed = typedColumn(col.name, unit ? mags : col.cells.map((v) => (isUnitCell(v) ? v.value : v)), rows, col.type ?? null);
      return { ...typed, ...(unit && typed.type === "number" ? { unit } : {}), ...(col.format ? { format: col.format } : {}) };
    }),
  };
}

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

const decimalExponent = (x: number): number => Number(Math.abs(x).toExponential().split("e")[1]);

/** `y` rounded at the 15th significant digit of `t`, the larger term of the conversion that produced it. */
export function roundAtLargerTerm(y: number, t: number): number {
  if (!Number.isFinite(y) || y === 0 || !Number.isFinite(t)) return y;
  const p = decimalExponent(y) - decimalExponent(t) + 15;
  return p < 1 ? 0 : p > 100 ? y : Number(y.toPrecision(p));
}

function dimKeyId(base: number, dim: Dim, display: string | undefined): string {
  const cur = dimEqual(dim, { currency: 1 }) ? (display ?? "") : "";
  const offset = (display ? fcUnitToUnit(display)?.offset : undefined) ?? 0;
  const key = roundAtLargerTerm(base, Math.max(Math.abs(base - offset), Math.abs(offset)));
  return `~u:${formatDim(dim)}${cur ? `:${cur}` : ""}:${String(key)}`;
}

function keyId(v: FrameCell | UnitCell): string {
  if (v === null || v === undefined) return "~null";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (isSolError(v)) return "~err:" + v.code;
  if (isUnitCell(v)) return v.ratio ? String(v.value) : dimKeyId(v.value, v.dim, v.display);
  return String(v);
}

function keyIdInColumn(v: FrameCell, unit: ColumnUnit | undefined): string {
  if (unit && typeof v === "number" && Number.isFinite(v)) return keyId(tagFrameCellUnit(v, unit) as FrameCell | UnitCell);
  return keyId(v);
}

function cellKeyId(cell: CubeCell, unit?: ColumnUnit): string | null {
  if (cell === null || isSolError(cell)) return null;
  if (typeof cell === "number" || typeof cell === "string" || typeof cell === "boolean") return keyIdInColumn(cell, unit);
  if (isUnitCell(cell)) return keyId(cell);
  return null;
}

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

export function selectCubeRows(cube: CubeValue, indices: readonly number[]): CubeValue {
  return makeCube(cube.columns.map((c) => ({
    name: c.name,
    ...(c.type ? { type: c.type } : {}),
    ...(c.format ? { format: c.format } : {}),
    cells: indices.map((i) => c.cells[i] ?? null),
  })));
}

function subCube(child: CubeValue, rowIdxs: number[]): CubeValue {
  return selectCubeRows(child, rowIdxs);
}

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

export function cubeColumnFromValue(value: unknown): CubeCell[] {
  if (value == null) return [];
  if (isCubeValue(value)) return [...(value.columns[0]?.cells ?? [])];
  if (isFrameValue(value)) return [value];
  if (Array.isArray(value)) return value as CubeCell[];
  return [value as CubeCell];
}

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
