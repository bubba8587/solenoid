// The literal inputs' shared editing helpers (Table / Frame / List / Cube Input all edit
// through the table popup; the Cube Input drills into the others). Pure: text ↔ records.

/** A cube's stored truth: JSON rows of records. A cell may be a scalar, a list of scalars,
 *  or a list of records (a nested table, or a nested cube when a record carries a list). */
export type CubeRecord = Record<string, unknown>;

export const DEFAULT_CUBE_TEXT = `[
  { "name": "A", "tags": ["x", "y"], "n": 1 },
  { "name": "B", "tags": [], "n": 2 }
]`;

/** Parse the stored text. Blank → no rows. Anything but a JSON array of objects is an error
 *  with the reason (the card shows it as #VALUE!). */
export function parseCubeRecords(text: string): { records: CubeRecord[] } | { error: string } {
  const t = text.trim();
  if (!t) return { records: [] };
  let v: unknown;
  try { v = JSON.parse(t); } catch (e) { return { error: `Cube Input: ${e instanceof Error ? e.message : "not JSON"}` }; }
  if (!Array.isArray(v)) return { error: "Cube Input: the text must be a JSON array of records" };
  const bad = v.findIndex((r) => !r || typeof r !== "object" || Array.isArray(r));
  if (bad >= 0) return { error: `Cube Input: row ${bad + 1} is not a record ({ ... })` };
  return { records: v as CubeRecord[] };
}

/** Records → the stored text (two-space JSON, one record per line block). */
export function cubeRecordsToText(records: readonly CubeRecord[]): string {
  return JSON.stringify(records, null, 2);
}

/** The List editor's one raw column → the rows to keep: one text per line, trailing blank
 *  lines dropped (a blank in the middle stays a blank row). */
export function listRowsFromCells(cells: readonly (readonly string[])[]): string[] {
  const rows = cells.map((r) => (r[0] ?? "").trim());
  while (rows.length && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

/** A path into the records: alternating row index and key, repeated per nesting level. */
export type CubePath = (number | string)[];

/** Read the value at a path ([row, key, row, key, …]); undefined when absent. */
export function getAtPath(records: readonly CubeRecord[], path: CubePath): unknown {
  let cur: unknown = records;
  for (const step of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[step as never];
  }
  return cur;
}

/** A copy of the records with `value` written at the path (creating rows/keys as needed). */
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

/** Is a list of records frame-shaped (every value scalar) — the Frame editor's job — or
 *  cube-shaped (some value is a list / nested records) — the Cube editor drills instead. */
export function recordsShape(v: unknown): "frame" | "cube" | "list" | "scalar" | "empty" {
  if (v == null) return "scalar";
  if (!Array.isArray(v)) return typeof v === "object" ? "cube" : "scalar";
  if (v.length === 0) return "empty";
  const allRecords = v.every((x) => x && typeof x === "object" && !Array.isArray(x));
  if (!allRecords) return "list";
  const nested = v.some((r) => Object.values(r as CubeRecord).some((x) => x != null && typeof x === "object"));
  return nested ? "cube" : "frame";
}

/** A scalar typed into a cell → its value: numbers and booleans parse, blank is null,
 *  everything else stays text (a date stays its text; the cube's typing reads it). */
export function parseCellText(text: string): unknown {
  const t = text.trim();
  if (t === "") return null;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  return text;
}

/** A cell value → the text the editor shows (lists and records show as JSON). */
export function cellTextOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
