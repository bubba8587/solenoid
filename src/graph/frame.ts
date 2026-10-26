// [[C24]] arraySemantics, [[C44]] dateSerials, [[D43]] unitByGranularity
import { wasmInvokeSync, wasmInferBin } from "./engineWasm";
import { encodeBinary, decodeBinary } from "./binaryCells";
import { parseDate } from "./nodes/dateSerial";
import { isSolError, solError, type SolError } from "./errorValue";
import { coerceLogical, decimalFromText } from "./valueKinds";
import { type ColumnUnit, type UnitCell, isUnitCell } from "./unitValue";
import { parseColumnUnitFromHeader, columnUnitFromSpec, tagFrameCellUnit, matrixCellsFromList } from "./unitColumn";
import { displayMagnitudeOf } from "./unitBridge";
import { elementFamilyOf, type SocketDataType } from "./sockets";
import { formatNumberWithAnnotation, isDateStyle, type FormatAnnotation } from "./formatAnnotationStore";
import { typesAt, isFrameAt, type ColumnTypes, type NestedTables } from "./cubeTypes";
import type { CubePath } from "./literalEditors";

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

export function colTypeForSocket(dataType: string | undefined): FrameColType | null {
  switch (elementFamilyOf(dataType as SocketDataType)) {
    case "number": return "number";
    case "string": return "string";
    case "date": return "date";
    case "logical": return "logical";
    default: return null;
  }
}

export function formatFrameCell(type: FrameColType, v: FrameCell, format?: FormatAnnotation): number | string | null {
  if (isSolError(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (type === "date" && typeof v === "number" && Number.isFinite(v)) {
    return formatNumberWithAnnotation(v, format && isDateStyle(format.format) ? format : ({ ...format, format: "date_dmy" } as FormatAnnotation));
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
  /** The new column's unit, in place of the one a `Name (unit)` header names; a replaced column drops its old unit. */
  columnUnit?: ColumnUnit | null,
): FrameValue {
  const { clean, unit: headerUnit } = parseColumnUnitFromHeader(name);
  const unit = columnUnit === undefined ? headerUnit : columnUnit;
  const unitTag = unit && type === "number" ? { unit } : {};
  const existingIdx = f.columns.findIndex((c) => c.name === clean.trim());
  if (existingIdx >= 0) {
    const columns = f.columns.map((c, i) => {
      if (i !== existingIdx) return c;
      const { unit: _old, ...rest } = c;
      return { ...(columnUnit === undefined ? c : rest), type, values, raw: undefined, ...unitTag };
    });
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

/** A list item read as a type. Text reads as a Frame cell does, so what the type can't read is NaN ([[D93]] oneTextReading). Converts, never filters; the caller passes null and per-cell errors through. */
export function coerceListItem(type: FrameColType, v: unknown): FrameCell {
  if (typeof v === "string" && type !== "string") return coerceFrameCell(type, v);
  switch (type) {
    case "number": {
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "boolean") return v ? 1 : 0;
      return null;
    }
    case "date": {
      return typeof v === "number" && Number.isFinite(v) ? v : null;
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
  return wasmInvokeSync<FrameSource>("engine_csv_source", { text: trimmed });
}

export function frameColumnsToInputText(columns: ReadonlyArray<FrameColumn>): string {
  return JSON.stringify(columns.map((c) => ({ name: c.name, type: c.type, values: c.values })));
}

export function frameFromInputText(text: string): FrameValue {
  return deriveFrame(parseFrameSource(text));
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

/** Each column of the one type every filled cell reads as, text otherwise, its trimmed text kept as `raw`; a list of one unit keeps it. The types are read on the core in one call (`nodes::infer_cells`); a text column's cells are its trimmed text, which the core doesn't send back. */
export function inferColumns(cols: ReadonlyArray<{ name: string; cells: ReadonlyArray<unknown> }>): FrameColumn[] {
  if (cols.length === 0) return [];
  const units: (ColumnUnit | undefined)[] = [];
  const raws: string[][] = [];
  const columns = cols.map(({ name, cells }): FrameColumn => {
    let unit: ColumnUnit | undefined;
    if (cells.some(isUnitCell)) ({ mags: cells, unit } = matrixCellsFromList(cells));
    units.push(unit);
    raws.push(cells.map((c) => (isSolError(c) ? c.code : c == null ? "" : String(c).trim())));
    return { name, type: "string", values: cells as FrameCell[] };
  });
  return decodeBinary(wasmInferBin(encodeBinary({ __frame: true, columns }))).map(({ type, values }, j) => {
    const name = cols[j].name;
    const raw = raws[j], unit = units[j];
    if (type === "string") values = raw.map((t, i) => (isSolError(columns[j].values[i]) ? columns[j].values[i] : t === "" ? null : t));
    return { name, type, values, raw, ...(type === "number" && unit ? { unit } : {}) };
  });
}

export function inferColumn(name: string, cells: ReadonlyArray<unknown>): FrameColumn {
  return inferColumns([{ name, cells }])[0];
}

/** From column `from` on, and for any column with no type of its own, each column the rows reach takes the type its cells read as; the others keep theirs. */
export function columnTypesAfterCsvEdit(
  types: ReadonlyArray<FrameColType>,
  from: number,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): FrameColType[] {
  const out = types.slice();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const start = Math.max(0, Math.min(from, out.length));
  const read = inferColumns(Array.from({ length: Math.max(0, width - start) }, (_, k) => ({ name: "", cells: rows.map((r) => r[start + k] ?? "") })));
  read.forEach((c, k) => (out[start + k] = c.type));
  return out;
}

export function frameFromCells(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<unknown>>): FrameValue {
  const ncols = Math.max(headers.length, rows.reduce((m, r) => Math.max(m, r.length), 0));
  const names = makeHeaders(headers, ncols);
  const columns = inferColumns(names.map((name, j) => ({ name, cells: rows.map((r) => r[j] ?? null) })));
  return { __frame: true, columns };
}

function recordKeys(records: ReadonlyArray<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const rec of records) for (const k of Object.keys(rec)) keys.add(k);
  return [...keys];
}

export function frameFromRecords(records: ReadonlyArray<Record<string, unknown>>): FrameValue {
  const keys = recordKeys(records);
  const names = makeHeaders(keys, keys.length);
  const columns = inferColumns(keys.map((key, j) => ({ name: names[j], cells: records.map((r) => r[key]) })));
  return { __frame: true, columns };
}

/** A record value a Frame cell can hold; a nested value (or anything else) is blank. */
const flatCell = (v: unknown): string | number | boolean | null =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;

/** A Cube cell's records as a flat Frame: a picked column crosses `coerceFrameCell` with its text kept as `raw`, the rest take `inferColumn`'s reading, and a nested value is blank, since a Frame cell is flat ([[D90]] cubeTypesAtDepth). */
export function frameCellFromRecords(records: ReadonlyArray<Record<string, unknown>>, picks: ColumnTypes = {}): FrameValue {
  const keys = recordKeys(records);
  const names = makeHeaders(keys, keys.length);
  const cellsOf = keys.map((key) => records.map((r) => flatCell(r[key])));
  const unpicked = keys.flatMap((key, j) => (picks[key] ? [] : [j]));
  const inferred = inferColumns(unpicked.map((j) => ({ name: names[j], cells: cellsOf[j] })));
  const inferredAt = new Map(unpicked.map((j, k) => [j, inferred[k]]));
  const columns = keys.map((key, j): FrameColumn => {
    const cells = cellsOf[j];
    const type = picks[key];
    if (!type) return inferredAt.get(j)!;
    const raw = cells.map((c) => (c == null ? "" : typeof c === "boolean" ? (c ? "TRUE" : "FALSE") : String(c)));
    return { name: names[j], type, values: raw.map((t, i) => (cells[i] == null ? null : coerceFrameCell(type, t))), raw };
  });
  return { __frame: true, columns };
}

function pickedCell(type: FrameColType, v: unknown): CubeCell {
  return v == null ? null : coerceFrameCell(type, String(v));
}

const listItemAs = (type: FrameColType, x: unknown): CubeCell =>
  Array.isArray(x) ? x.map((y) => listItemAs(type, y)) : x == null || isSolError(x) || isCubeValue(x) || isFrameValue(x) ? (x as CubeCell) : coerceListItem(type, x);

/** A cell read as its column's declared type ([[D90]] cubeTypesAtDepth): a value as a Frame cell is (unreadable is NaN), a list's items as List Input's are (unreadable is blank). A nested table keeps its own columns' types. The cells as typed are never changed. */
export function typedCubeCell(type: FrameColType, c: CubeCell): CubeCell {
  if (c == null || isSolError(c) || isCubeValue(c) || isFrameValue(c)) return c;
  if (Array.isArray(c)) return c.map((x) => listItemAs(type, x));
  return isUnitCell(c) ? c : pickedCell(type, c);
}

/** Records to a Cube: `picks` types the top level's columns, and each table nested in a cell takes what `nested` declares for its own records path, under `base`: a Frame or a Cube, and its columns' types ([[D90]] cubeTypesAtDepth). */
export function recordsToCube(
  records: ReadonlyArray<Record<string, unknown>>,
  picks: ColumnTypes = {},
  nested: NestedTables = {},
  base: CubePath = [],
): CubeValue {
  const keys = recordKeys(records);
  const names = makeHeaders(keys, keys.length);
  const tableAt = (rows: Record<string, unknown>[], at: CubePath): CubeCell =>
    isFrameAt(nested, at) ? frameCellFromRecords(rows, typesAt(nested, at)) : recordsToCube(rows, typesAt(nested, at), nested, at);
  const toCell = (v: unknown, at: CubePath): CubeCell => {
    if (v == null) return null;
    if (Array.isArray(v)) {
      const present = v.filter((x) => x != null);
      const objs = present.filter((x) => typeof x === "object" && !Array.isArray(x));
      if (present.length > 0 && objs.length === present.length) return tableAt(v.map((x) => (x ?? {}) as Record<string, unknown>), at);
      return v.map((x, i) => toCell(x, [...at, i]));
    }
    if (typeof v === "object") return tableAt([v as Record<string, unknown>], at);
    return v as FrameCell;
  };
  const cellsOf = keys.map((key) => records.map((r, i) => toCell(r[key], [...base, i, key])));
  const guessed = keys.flatMap((key, j) => (!picks[key] && cellsOf[j].every((c) => c == null || typeof c !== "object") ? [j] : []));
  const inferred = inferColumns(guessed.map((j) => ({ name: names[j], cells: cellsOf[j] })));
  const guessedType = new Map(guessed.map((j, k) => [j, inferred[k].type]));
  return cubeFromColumns(keys.map((key, j) => {
    const cells = cellsOf[j];
    const pick = picks[key];
    const type = guessedType.get(j);
    if (type) return { name: names[j], cells, type };
    if (pick && cells.every((c) => c == null || typeof c !== "object")) return { name: names[j], cells: cells.map((c) => pickedCell(pick, c)), type: pick };
    return pick ? { name: names[j], cells: cells.map((c) => typedCubeCell(pick, c)), type: pick } : { name: names[j], cells };
  }));
}

export function frameFromRows(rows: ReadonlyArray<ReadonlyArray<unknown>>, headers?: ReadonlyArray<string>): FrameValue {
  const ncols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const names = makeHeaders(headers ?? [], ncols);
  const columns = inferColumns(names.map((name, j) => ({ name, cells: rows.map((r) => r[j]) })));
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

export function makeCube(columns: CubeColumn[]): CubeValue {
  return { __cube: true, columns, depth: computeCubeDepth(columns) };
}

export function cubeDepth(c: CubeValue): number {
  return c.depth;
}

export function cubeRowCount(c: CubeValue): number {
  return c.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
}

function cubeCellsFromColumn(col: FrameColumn): CubeCell[] {
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

export function frameFromColumnar(obj: Record<string, unknown>): FrameValue {
  const keys = Object.keys(obj);
  const names = makeHeaders(keys, keys.length);
  const columns = inferColumns(keys.map((key, j) => {
    const v = obj[key];
    return { name: names[j], cells: Array.isArray(v) ? v : [v] };
  }));
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
