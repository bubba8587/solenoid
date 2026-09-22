// [[C107]] obsidianPlugin, [[D72]] pluginSaveWritesSourceText
// A property's YAML value ⇄ the value a chip and its popup take. Pure: no DOM, no Obsidian.
import { parseDateToSerial, serialToJsDate } from "../../src/graph/nodes/dateSerial";
import { parseCellText } from "../../src/graph/literalEditors";
import { parseCx } from "../../src/graph/cxValue";
import { type FrameColType, type FrameSourceColumn } from "../../src/graph/frame";

export type Family = "number" | "string" | "date" | "logical" | "complex";
export type Shape = "scalar" | "list" | "matrix" | "frame" | "cube";

export interface PropertyKind {
  /** Obsidian's type id, written to `.obsidian/types.json`: `solenoid-` + the socket variant. */
  id: string;
  name: string;
  shape: Shape;
  family?: Family;
}

const FAMILIES: { family: Family; label: string; list: string; table: string }[] = [
  { family: "number", label: "Numeric", list: "list", table: "table" },
  { family: "string", label: "String", list: "strlist", table: "strtable" },
  { family: "date", label: "Date", list: "datelist", table: "datetable" },
  { family: "complex", label: "Complex", list: "complexlist", table: "complextable" },
  { family: "logical", label: "Boolean", list: "logicallist", table: "logicaltable" },
];

export const PROPERTY_KINDS: PropertyKind[] = [
  // The one scalar: Obsidian types a number, text, a date and a checkbox itself.
  { id: "solenoid-complex", name: "Complex", shape: "scalar", family: "complex" },
  ...FAMILIES.flatMap((f): PropertyKind[] => [
    { id: `solenoid-${f.list}`, name: `${f.label} List`, shape: "list", family: f.family },
    { id: `solenoid-${f.table}`, name: `${f.label} Matrix`, shape: "matrix", family: f.family },
  ]),
  { id: "solenoid-frame", name: "Frame", shape: "frame" },
  { id: "solenoid-cube", name: "Cube", shape: "cube" },
];

type Scalar = number | string | boolean | null;
export type YamlRecord = Record<string, unknown>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

const isPlainObject = (v: unknown): v is YamlRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown): v is Scalar => v === null || typeof v !== "object";

function fitsFamily(v: unknown, family: Family): boolean {
  if (v === null || v === undefined) return true;
  switch (family) {
    case "number": return typeof v === "number";
    case "string": return typeof v === "string";
    case "logical": return typeof v === "boolean";
    case "date": return typeof v === "string" && ISO_DATE.test(v) && Number.isFinite(parseDateToSerial(v));
    case "complex": return typeof v === "number" || (typeof v === "string" && parseCx(v) !== null);
  }
}

/** Does this YAML value have the kind's SHAPE? Obsidian warns on a mismatch and never calls
 *  render. Inside a list or matrix the family is a lens, not a gate: a cell it cannot read is
 *  the chip's to show as unreadable, never Obsidian's to refuse (author 2026-09-22). The Complex
 *  field, a scalar, still takes only what it can read. */
export function validateYaml(kind: PropertyKind, value: unknown): boolean {
  if (kind.shape === "scalar") return value === "" || (isScalar(value) && fitsFamily(value, kind.family!));
  if (!Array.isArray(value)) return false;
  switch (kind.shape) {
    case "list": return value.every(isScalar);
    case "matrix":
      return value.every((row) => Array.isArray(row) && row.every(isScalar));
    case "frame": return value.every((row) => isPlainObject(row) && Object.values(row).every(isScalar));
    case "cube": return value.every(isPlainObject);
  }
}

const scalarOrNull = (v: unknown): Scalar => (isScalar(v) ? v : null);
const named = (cells: unknown[]): YamlRecord =>
  Object.fromEntries(cells.map((v, j) => [`Col${j + 1}`, scalarOrNull(v)]));

/** A value reshaped to the kind's shape. Obsidian's "Update" on a type switch hands a widget the
 *  OLD value, whatever it was, so every kind takes anything. A value that already fits comes back
 *  untouched; the rest widens as the socket boundary does (a scalar is one element, a list one
 *  row, a matrix gets `Col1…` names). Narrowing keeps what it can: a matrix or rows flatten into a
 *  list row by row, and every cell keeps its scalar (the family is a lens; only the Complex
 *  field, a scalar, reads or refuses). Pure: nothing is written until the editor's Save. */
export function coerceYaml(kind: PropertyKind, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return kind.shape === "scalar" ? null : [];
  if (validateYaml(kind, value)) return value;
  const items = Array.isArray(value) ? value : [value];
  const cell = (v: unknown): Scalar => (kind.shape === "scalar" && kind.family ? cellToYaml(rawCell(scalarOrNull(v)), kind.family) : scalarOrNull(v));
  const rowOf = (item: unknown): unknown[] =>
    Array.isArray(item) ? item : isPlainObject(item) ? Object.values(item) : [item];
  const flat = items.every(isScalar);
  switch (kind.shape) {
    case "list": return items.flatMap(rowOf).map(cell);
    case "matrix": return (flat ? [items] : items.map(rowOf)).map((row) => row.map(cell));
    case "frame": {
      if (flat) return [named(items)];
      return items.map((item) =>
        isPlainObject(item)
          ? Object.fromEntries(Object.entries(item).map(([k, v]) => [k, scalarOrNull(v)]))
          : named(rowOf(item)));
    }
    case "cube": return flat ? [named(items)] : items.map((item) => (isPlainObject(item) ? item : named(rowOf(item))));
    case "scalar": return items.flatMap(rowOf).map(cell)[0] ?? null;
  }
}

/** A scalar property's text: the value itself, or after a type switch the first cell that reads. */
export function scalarText(kind: PropertyKind, value: unknown): string {
  return rawCell(coerceYaml(kind, value));
}

function cellFromYaml(v: unknown, family: Family): Scalar {
  if (v === null || v === undefined) return null;
  if (family === "date") {
    const serial = parseDateToSerial(String(v));
    return Number.isFinite(serial) ? serial : null;
  }
  if (family === "complex") return String(v);
  return v as Scalar;
}

/** A list property → the flat cell list an ArrayChip takes (dates as serials). */
export function listFromYaml(value: unknown, family: Family): Scalar[] {
  return Array.isArray(value) ? value.map((v) => cellFromYaml(v, family)) : [];
}

/** A matrix property → rectangular rows (short rows pad with missing cells). */
export function matrixFromYaml(value: unknown, family: Family): Scalar[][] {
  if (!Array.isArray(value)) return [];
  const rows = value.map((row) => (Array.isArray(row) ? row.map((v) => cellFromYaml(v, family)) : []));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => Array.from({ length: width }, (_, j) => r[j] ?? null));
}

export function isoDate(serial: number): string {
  return serialToJsDate(serial).toISOString().slice(0, 10);
}

/** One edited cell's raw text → the YAML scalar for its family; unreadable text is missing. */
export function cellToYaml(raw: string, family: Family): Scalar {
  if (family === "string") return raw === "" ? null : raw;
  const t = raw.trim();
  if (t === "") return null;
  switch (family) {
    case "number": {
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    }
    case "logical": {
      const l = t.toLowerCase();
      return l === "true" || l === "1" ? true : l === "false" || l === "0" ? false : null;
    }
    case "date": {
      const n = Number(t);
      const serial = Number.isFinite(n) ? n : parseDateToSerial(t);
      return Number.isFinite(serial) ? isoDate(serial) : null;
    }
    case "complex": return parseCx(t) === null ? null : t;
  }
}

/** An editor on an empty value opens with one blank row to type into, and Add Row leaves more:
 *  blank rows at the END are the editor's, never the note's. A blank row in the middle stays. */
function dropTrailingBlank<T>(rows: T[], isBlank: (row: T) => boolean): T[] {
  let end = rows.length;
  while (end > 0 && isBlank(rows[end - 1])) end--;
  return rows.slice(0, end);
}

/** The popup's edited raw grid → a matrix property. */
export function matrixToYaml(cells: string[][], original: unknown = []): Scalar[][] {
  const was = Array.isArray(original) ? original : [];
  const rows = cells.map((row, i) => row.map((text, j) => sourceScalar(Array.isArray(was[i]) ? (was[i] as unknown[])[j] : undefined, text)));
  return dropTrailingBlank(rows, (row) => row.every((v) => v === null));
}

/** The editor's one-column grid → the list; the property's family is a lens and never touches
 *  a cell (a cell it cannot read shows as unreadable, and saves as typed). */
export function listToYaml(cells: string[][], original: unknown = []): Scalar[] {
  const was = Array.isArray(original) ? original : [];
  return dropTrailingBlank(cells.map((row, i) => sourceScalar(was[i], row[0] ?? "")), (v) => v === null);
}

export function rawCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
}

/** A frame's column types as the user picked them, by column name: the app's own type names.
 *  Kept in the plugin's `data.json` under the property's name (a note's rows have no slot for it). */
export type ColumnTypes = Record<string, FrameColType>;

const COLUMN_TYPES: readonly FrameColType[] = ["number", "string", "date", "logical"];
const isColumnType = (t: unknown): t is FrameColType => COLUMN_TYPES.includes(t as FrameColType);

/** What `data.json` held → only the entries that are real column types. */
export function readColumnTypes(raw: unknown): Record<string, ColumnTypes> {
  const out: Record<string, ColumnTypes> = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, cols] of Object.entries(raw)) {
    if (!isPlainObject(cols)) continue;
    const types: ColumnTypes = {};
    for (const [name, t] of Object.entries(cols)) if (isColumnType(t)) types[name] = t;
    out[key] = types;
  }
  return out;
}

/** The FIRST guess for a column nobody has typed, from the YAML values' own types and never
 *  their text: a quoted `"0012"` is Text, so a Save cannot turn it into 12. */
function guessColumnType(values: unknown[]): FrameColType {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (present.length === 0) return "string";
  if (present.every((v) => typeof v === "boolean")) return "logical";
  if (present.every((v) => typeof v === "number")) return "number";
  if (present.every((v) => fitsFamily(v, "date"))) return "date";
  return "string";
}

/** A frame property → Frame Input's literal source: raw text per cell, and per column the
 *  type the user picked (`picked`), else the first guess. */
export function frameSourceFromYaml(value: unknown, picked: ColumnTypes = {}): FrameSourceColumn[] {
  const records = Array.isArray(value) ? value.filter(isPlainObject) : [];
  const keys: string[] = [];
  for (const rec of records) for (const k of Object.keys(rec)) if (!keys.includes(k)) keys.push(k);
  return keys.map((name) => {
    const values = records.map((rec) => (isScalar(rec[name]) ? rec[name] : null));
    return { name, type: picked[name] ?? guessColumnType(values), cells: values.map(rawCell) };
  });
}

const savedName = (col: FrameSourceColumn, j: number): string => col.name || `Col${j + 1}`;

/** The types to remember after a Save: every written column's, under the name it was written as. */
export function columnTypesOf(columns: FrameSourceColumn[]): ColumnTypes {
  const types: ColumnTypes = {};
  columns.filter((c) => !c.expr).forEach((col, j) => { types[savedName(col, j)] = col.type; });
  return types;
}

/** A cell's text as YAML reads a plain scalar (the Cube editor's own rule): a number,
 *  true/false, blank → missing, else the text. What was typed goes to the note as typed; no
 *  type touches it. */
export const scalarFromText = (text: string): Scalar => parseCellText(text) as Scalar;

/** A saved cell: the scalar it came in with when its text is unchanged, else what was typed. */
const sourceScalar = (before: unknown, text: string): Scalar =>
  before !== undefined && isScalar(before) && rawCell(before) === text ? before : scalarFromText(text);

/** The edited literal source → rows of `{name: value}`; every row keeps every key. A cell is
 *  its SOURCE TEXT, never a value pushed through the column's type: an unchanged cell keeps the
 *  scalar it came in with (`original`, the rows the editor opened on) and an edited one is what
 *  was typed as YAML reads it. The type is a lens, kept in the plugin's data (author 2026-09-22,
 *  as the app's Frame Input keeps its literal source). */
export function frameSourceToYaml(columns: FrameSourceColumn[], original: unknown = []): YamlRecord[] {
  const data = columns.filter((c) => !c.expr);
  const was = Array.isArray(original) ? original.filter(isPlainObject) : [];
  const rows = data.reduce((m, c) => Math.max(m, c.cells.length), 0);
  const names = data.map(savedName);
  const records = Array.from({ length: rows }, (_, r) => {
    const rec: YamlRecord = {};
    data.forEach((col, j) => {
      rec[names[j]] = sourceScalar(was[r]?.[names[j]], col.cells[r] ?? "");
    });
    return rec;
  });
  return dropTrailingBlank(records, (rec) => Object.values(rec).every((v) => v === null));
}
