// [[C28]] literalsIffEditable
// Shared editing helpers for the literal inputs (Table, Frame, List and Cube Input all edit through the table popup).
// Pure: text to records and back.
import { isColumnType, readNestedTables, type ColumnTypes, type NestedTables } from "./cubeTypes";

/** A cell is a scalar, a list of scalars, or a list of records (a nested table, or a nested cube). */
export type CubeRecord = Record<string, unknown>;

export const DEFAULT_CUBE_TEXT = `[
  { "name": "A", "tags": ["x", "y"], "n": 1 },
  { "name": "B", "tags": [], "n": 2 }
]`;

/** A Cube Input column: no `type` is untyped ([[D90]] cubeTypesAtDepth); `expr` makes it a formula column. */
export interface CubeSourceColumn {
  name: string;
  type?: "number" | "string" | "date" | "logical";
  expr?: string;
}

/** Cube Input's stored truth: the records as typed, every column in its order, and the types of the tables nested in its cells, each keyed by where it sits. */
export interface CubeSource {
  columns: CubeSourceColumn[];
  rows: CubeRecord[];
  nested?: NestedTables;
}

export function recordKeys(rows: readonly unknown[]): string[] {
  const keys: string[] = [];
  for (const r of rows) if (r && typeof r === "object" && !Array.isArray(r)) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return keys;
}

/** Blank gives no rows. The text is a JSON array of records, or `{ columns, rows }` when a column carries a type or a formula. Anything else is an error with its reason (shown as #VALUE!). */
export function parseCubeSource(text: string): { source: CubeSource } | { error: string } {
  const t = text.trim();
  if (!t) return { source: { columns: [], rows: [] } };
  let v: unknown;
  try { v = JSON.parse(t); } catch (e) { return { error: `Cube Input: ${e instanceof Error ? e.message : "not JSON"}` }; }
  const declared: CubeSourceColumn[] = [];
  let nested: NestedTables = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as { columns?: unknown; rows?: unknown; nested?: unknown };
    if (!Array.isArray(o.rows) || !Array.isArray(o.columns)) return { error: "Cube Input: the text must be a JSON array of records, or { columns, rows }" };
    for (const c of o.columns) {
      const name = c && typeof c === "object" && typeof (c as CubeSourceColumn).name === "string" ? (c as CubeSourceColumn).name : "";
      if (!name || declared.some((d) => d.name === name)) continue;
      const { type, expr } = c as CubeSourceColumn;
      declared.push({
        name,
        ...(isColumnType(type) ? { type } : {}),
        ...(typeof expr === "string" ? { expr } : {}),
      });
    }
    nested = readNestedTables(o.nested);
    v = o.rows;
  }
  if (!Array.isArray(v)) return { error: "Cube Input: the text must be a JSON array of records" };
  const bad = v.findIndex((r) => !r || typeof r !== "object" || Array.isArray(r));
  if (bad >= 0) return { error: `Cube Input: row ${bad + 1} is not a record ({ ... })` };
  const rows = v as CubeRecord[];
  const columns = [...declared, ...recordKeys(rows).filter((k) => !declared.some((d) => d.name === k)).map((name) => ({ name }))];
  return { source: { columns, rows, ...(Object.keys(nested).length ? { nested } : {}) } };
}

const hasNested = (source: CubeSource): boolean => !!source.nested && Object.keys(source.nested).length > 0;

/** Plain records while nothing is typed or computed, so an untyped cube reads as the JSON it is. */
export function cubeSourceToText(source: CubeSource): string {
  const plain = !hasNested(source) && source.columns.every((c) => !c.type && c.expr === undefined)
    && recordKeys(source.rows).join("\u0000") === source.columns.map((c) => c.name).join("\u0000");
  if (plain) return JSON.stringify(source.rows, null, 2);
  const columns = source.columns.map((c) => ({ name: c.name, ...(c.type ? { type: c.type } : {}), ...(c.expr !== undefined ? { expr: c.expr } : {}) }));
  return JSON.stringify({ columns, rows: source.rows, ...(hasNested(source) ? { nested: source.nested } : {}) }, null, 2);
}

/** The top level's declared types; a formula column declares none. */
export function sourcePicks(source: CubeSource): ColumnTypes {
  return Object.fromEntries(source.columns.flatMap((c) => (c.type && c.expr === undefined ? [[c.name, c.type]] : [])));
}

/** Alternating row index and key, repeated per nesting level. */
export type CubePath = (number | string)[];

export function getAtPath(records: readonly CubeRecord[], path: CubePath): unknown {
  let cur: unknown = records;
  for (const step of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[step as never];
  }
  return cur;
}

export function setAtPath(records: readonly CubeRecord[], path: CubePath, value: unknown): CubeRecord[] {
  const next = structuredClone(records) as CubeRecord[];
  if (path.length === 0) return Array.isArray(value) ? (value as CubeRecord[]) : next;
  let cur: unknown = next;
  for (let i = 0; i < path.length - 1; i++) {
    const step = path[i];
    const holder = cur as Record<string | number, unknown>;
    if (holder[step as never] == null) holder[step as never] = typeof path[i + 1] === "number" ? [] : {};
    cur = holder[step as never];
  }
  (cur as Record<string | number, unknown>)[path[path.length - 1] as never] = value;
  return next;
}

/** Frame-shaped when every value is scalar; cube-shaped when some value is a list or nested records; a matrix when every item is a row of its own. */
export function recordsShape(v: unknown): "frame" | "cube" | "matrix" | "list" | "scalar" | "empty" {
  if (v == null) return "scalar";
  if (!Array.isArray(v)) return typeof v === "object" ? "cube" : "scalar";
  if (v.length === 0) return "empty";
  if (v.every((x) => Array.isArray(x))) return "matrix";
  const allRecords = v.every((x) => x && typeof x === "object" && !Array.isArray(x));
  if (!allRecords) return "list";
  const nested = v.some((r) => Object.values(r as CubeRecord).some((x) => x != null && typeof x === "object"));
  return nested ? "cube" : "frame";
}

/** Numbers and booleans parse, blank is null, everything else stays text. */
export function parseCellText(text: string): unknown {
  const t = text.trim();
  if (t === "") return null;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  return text;
}

/** What an editing cell holds ([[D90]] cubeTypesAtDepth): a value, a list, a table (rows of values, the app's 2-D shape), a Frame or a Cube (records). */
export type CellKind = "value" | "list" | "table" | "frame" | "cube";

/** Records are a Frame only where the cell is declared one (`isFrameAt`); otherwise a Cube. */
export function cellKindOf(v: unknown, frame = false): CellKind {
  const shape = recordsShape(v);
  if (shape === "list" || shape === "empty") return "list";
  if (shape === "matrix") return "table";
  if (shape === "frame" || shape === "cube") return frame ? "frame" : "cube";
  return "value";
}

export const newColumnKey = (n: number): string => `Column ${n}`;

const isPlainValue = (v: unknown): boolean => v === null || typeof v !== "object";
const tableRows = (v: unknown): CubeRecord[] => (Array.isArray(v) ? (v as CubeRecord[]) : v && typeof v === "object" ? [v as CubeRecord] : []);
const isRecords = (k: CellKind): boolean => k === "frame" || k === "cube";

/** The cell's contents as rows of values: a value one cell, a list one row, records their rows in key order. */
function asGrid(v: unknown, kind: CellKind): unknown[][] {
  if (kind === "value") return [[v ?? null]];
  if (kind === "list") return [v as unknown[]];
  if (kind === "table") return (v as unknown[][]).map((row) => [...row]);
  const rows = tableRows(v);
  const keys = recordKeys(rows);
  return rows.map((r) => keys.map((k) => r[k] ?? null));
}

/** The cell switched from `from` to `to`, keeping what it can: a value becomes the first item or cell; a list is a table's first row and a Frame's or Cube's first column, and back; records' rows become a table's and back (the column names go); a Cube and a Frame keep their records, a Frame blanking any nested cell; Value keeps the first plain value found. */
export function convertCellKind(v: unknown, from: CellKind, to: CellKind): unknown {
  if (from === to) return v;
  if (isRecords(from) && isRecords(to)) {
    return to === "cube" ? v : tableRows(v).map((r) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, isPlainValue(x) ? x : null])));
  }
  const grid = asGrid(v, from).filter((row) => row.length > 0);
  if (to === "value") {
    const first = grid[0]?.[0];
    return first !== undefined && isPlainValue(first) ? first : null;
  }
  if (to === "list") return from === "value" && v == null ? [] : (isRecords(from) ? grid.map((row) => row[0] ?? null) : grid[0] ?? []);
  if (to === "table") return grid.length ? grid : [[null]];
  const rows = from === "list" ? grid[0]?.map((x) => [x]) ?? [] : grid;
  if (!rows.length) rows.push([null]);
  return rows.map((row) => Object.fromEntries(row.map((x, j) => [newColumnKey(j + 1), to === "frame" && !isPlainValue(x) ? null : x ?? null])));
}

export function cellTextOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
