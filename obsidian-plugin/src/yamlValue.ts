// [[C107]] obsidianPlugin, [[D72]] pluginSaveWritesSourceText
import { parseDateToSerial, noteDateSerial, noteDateText } from "../../src/graph/nodes/dateSerial";
import { parseCellText } from "../../src/graph/literalEditors";
import { parseCx } from "../../src/graph/cxValue";
import { guessNoteColumnType, type FrameColType, type FrameSourceColumn } from "../../src/graph/frame";

export type Family = "number" | "string" | "date" | "logical" | "complex";
export type Shape = "scalar" | "list" | "matrix" | "frame" | "cube";

export interface PropertyKind {
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

const isPlainObject = (v: unknown): v is YamlRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown): v is Scalar => v === null || typeof v !== "object";

function fitsFamily(v: unknown, family: Family): boolean {
  if (v === null || v === undefined) return true;
  switch (family) {
    case "number": return typeof v === "number";
    case "string": return typeof v === "string";
    case "logical": return typeof v === "boolean";
    case "date": return typeof v === "string" && noteDateSerial(v) !== null;
    case "complex": return typeof v === "number" || (typeof v === "string" && parseCx(v) !== null);
  }
}

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

export function listFromYaml(value: unknown, family: Family): Scalar[] {
  return Array.isArray(value) ? value.map((v) => cellFromYaml(v, family)) : [];
}

export function matrixFromYaml(value: unknown, family: Family): Scalar[][] {
  if (!Array.isArray(value)) return [];
  const rows = value.map((row) => (Array.isArray(row) ? row.map((v) => cellFromYaml(v, family)) : []));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => Array.from({ length: width }, (_, j) => r[j] ?? null));
}

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
      return Number.isFinite(serial) ? noteDateText(serial) : null;
    }
    case "complex": return parseCx(t) === null ? null : t;
  }
}

function dropTrailingBlank<T>(rows: T[], isBlank: (row: T) => boolean): T[] {
  let end = rows.length;
  while (end > 0 && isBlank(rows[end - 1])) end--;
  return rows.slice(0, end);
}

export function matrixToYaml(cells: string[][], original: unknown = []): Scalar[][] {
  const was = Array.isArray(original) ? original : [];
  const rows = cells.map((row, i) => row.map((text, j) => sourceScalar(Array.isArray(was[i]) ? (was[i] as unknown[])[j] : undefined, text)));
  return dropTrailingBlank(rows, (row) => row.every((v) => v === null));
}

export function listToYaml(cells: string[][], original: unknown = []): Scalar[] {
  const was = Array.isArray(original) ? original : [];
  return dropTrailingBlank(cells.map((row, i) => sourceScalar(was[i], row[0] ?? "")), (v) => v === null);
}

export function rawCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
}

export type ColumnTypes = Record<string, FrameColType>;

const COLUMN_TYPES: readonly FrameColType[] = ["number", "string", "date", "logical"];
const isColumnType = (t: unknown): t is FrameColType => COLUMN_TYPES.includes(t as FrameColType);

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

export function frameSourceFromYaml(value: unknown, picked: ColumnTypes = {}): FrameSourceColumn[] {
  const records = Array.isArray(value) ? value.filter(isPlainObject) : [];
  const keys: string[] = [];
  for (const rec of records) for (const k of Object.keys(rec)) if (!keys.includes(k)) keys.push(k);
  return keys.map((name) => {
    const values = records.map((rec) => (isScalar(rec[name]) ? rec[name] : null));
    return { name, type: picked[name] ?? guessNoteColumnType(values, (v) => fitsFamily(v, "date")), cells: values.map(rawCell) };
  });
}

const savedName = (col: FrameSourceColumn, j: number): string => col.name || `Col${j + 1}`;

export function columnTypesOf(columns: FrameSourceColumn[]): ColumnTypes {
  const types: ColumnTypes = {};
  columns.filter((c) => !c.expr).forEach((col, j) => { types[savedName(col, j)] = col.type; });
  return types;
}

export const scalarFromText = (text: string): Scalar => parseCellText(text) as Scalar;

const sourceScalar = (before: unknown, text: string): Scalar =>
  before !== undefined && isScalar(before) && rawCell(before) === text ? before : scalarFromText(text);

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
