// [[C28]] literalsIffEditable
// Shared editing helpers for the literal inputs (Table, Frame, List and Cube Input all edit through the table popup).
// Pure: text to records and back.

/** A cell is a scalar, a list of scalars, or a list of records (a nested table, or a nested cube). */
export type CubeRecord = Record<string, unknown>;

export const DEFAULT_CUBE_TEXT = `[
  { "name": "A", "tags": ["x", "y"], "n": 1 },
  { "name": "B", "tags": [], "n": 2 }
]`;

/** Blank gives no rows; anything but a JSON array of objects is an error with its reason (shown as #VALUE!). */
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

export function cubeRecordsToText(records: readonly CubeRecord[]): string {
  return JSON.stringify(records, null, 2);
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

/** Frame-shaped when every value is scalar; cube-shaped when some value is a list or nested records. */
export function recordsShape(v: unknown): "frame" | "cube" | "list" | "scalar" | "empty" {
  if (v == null) return "scalar";
  if (!Array.isArray(v)) return typeof v === "object" ? "cube" : "scalar";
  if (v.length === 0) return "empty";
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

export function cellTextOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
