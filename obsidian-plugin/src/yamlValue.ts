// [[C107]] obsidianPlugin
// A property's YAML value ⇄ the value a chip and its popup take. Pure: no DOM, no Obsidian.
import { parseDateToSerial, serialToJsDate } from "../../src/graph/nodes/dateSerial";
import { parseCx } from "../../src/graph/cxValue";
import { coerceFrameCell, inferColumn, type FrameSourceColumn } from "../../src/graph/frame";

export type Family = "number" | "string" | "date" | "logical" | "complex";
export type Shape = "list" | "matrix" | "frame" | "cube";

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

/** Does this YAML value have the kind's shape? Obsidian warns on a mismatch and never calls render. */
export function validateYaml(kind: PropertyKind, value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  switch (kind.shape) {
    case "list": return value.every((v) => isScalar(v) && fitsFamily(v, kind.family!));
    case "matrix":
      return value.every((row) => Array.isArray(row) && row.every((v) => isScalar(v) && fitsFamily(v, kind.family!)));
    case "frame": return value.every((row) => isPlainObject(row) && Object.values(row).every(isScalar));
    case "cube": return value.every(isPlainObject);
  }
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

/** The popup's edited raw grid → a matrix property. */
export function matrixToYaml(cells: string[][], family: Family): Scalar[][] {
  return cells.map((row) => row.map((c) => cellToYaml(c, family)));
}

/** The one-column list editor's raw grid → a list property. */
export function listToYaml(cells: string[][], family: Family): Scalar[] {
  return cells.map((row) => cellToYaml(row[0] ?? "", family));
}

/** The text a cell is typed as: what the raw-text editors open on and hand back. */
export function rawCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
}

/** A frame property → Frame Input's literal source: raw text per cell, a type per column
 *  inferred from that text (so a YAML `true` column is Boolean, an ISO column a Date). */
export function frameSourceFromYaml(value: unknown): FrameSourceColumn[] {
  const records = Array.isArray(value) ? value.filter(isPlainObject) : [];
  const keys: string[] = [];
  for (const rec of records) for (const k of Object.keys(rec)) if (!keys.includes(k)) keys.push(k);
  return keys.map((name) => {
    const cells = records.map((rec) => rawCell(isScalar(rec[name]) ? rec[name] : null));
    return { name, type: inferColumn(name, cells).type, cells };
  });
}

/** The edited literal source → rows of `{name: value}`; every row keeps every key. */
export function frameSourceToYaml(columns: FrameSourceColumn[]): YamlRecord[] {
  const data = columns.filter((c) => !c.expr);
  const rows = data.reduce((m, c) => Math.max(m, c.cells.length), 0);
  const names = data.map((c, j) => c.name || `Col${j + 1}`);
  return Array.from({ length: rows }, (_, r) => {
    const rec: YamlRecord = {};
    data.forEach((col, j) => {
      const v = coerceFrameCell(col.type, col.cells[r] ?? "");
      const missing = v === null || typeof v === "object" || (typeof v === "number" && !Number.isFinite(v));
      rec[names[j]] = missing ? null : col.type === "date" ? isoDate(v as number) : v;
    });
    return rec;
  });
}
