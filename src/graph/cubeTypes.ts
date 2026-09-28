// [[D90]] cubeTypesAtDepth
// The declared column types of tables nested in a Cube's cells: one entry per table, keyed by where it sits.
// Pure JSON, so Cube Input's source and the Solenoid Properties plugin's store hold it as it is.
import type { FrameColType } from "./frame";
import type { CubePath } from "./literalEditors";

/** One table's picks, a type per column. */
export type ColumnTypes = Readonly<Record<string, FrameColType>>;
/** Every nested table's picks, keyed by its records path (`tableKey`): row and key down from the top, a list index where a list holds it. */
export type NestedTypes = Readonly<Record<string, ColumnTypes>>;

const COLUMN_TYPES: readonly FrameColType[] = ["number", "string", "date", "logical"];
export const isColumnType = (t: unknown): t is FrameColType => COLUMN_TYPES.includes(t as FrameColType);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const tableKey = (path: CubePath): string => JSON.stringify(path);

function pathOf(key: string): CubePath | null {
  try {
    const p: unknown = JSON.parse(key);
    return Array.isArray(p) && p.length > 0 && p.every((s) => typeof s === "string" || (typeof s === "number" && Number.isInteger(s) && s >= 0)) ? p : null;
  } catch { return null; }
}

const startsWith = (path: CubePath, prefix: CubePath): boolean => prefix.length <= path.length && prefix.every((s, i) => path[i] === s);

/** A table's picks, a type per column; anything else is dropped. */
export function readColumnTypes(raw: unknown): ColumnTypes {
  const out: Record<string, FrameColType> = {};
  if (isRecord(raw)) for (const [name, t] of Object.entries(raw)) if (isColumnType(t)) out[name] = t;
  return out;
}

/** Keys that are not a records path, and picks that are not types, are dropped. */
export function readNestedTypes(raw: unknown): NestedTypes {
  const out: Record<string, ColumnTypes> = {};
  if (!isRecord(raw)) return out;
  for (const [key, cols] of Object.entries(raw)) {
    const path = pathOf(key);
    const types = readColumnTypes(cols);
    if (path && Object.keys(types).length) out[tableKey(path)] = types;
  }
  return out;
}

export const typesAt = (nested: NestedTypes, tablePath: CubePath): ColumnTypes => nested[tableKey(tablePath)] ?? {};

function rekey(nested: NestedTypes, fn: (path: CubePath, types: ColumnTypes) => [CubePath, ColumnTypes] | null): NestedTypes {
  const out: Record<string, ColumnTypes> = {};
  for (const [key, types] of Object.entries(nested)) {
    const path = pathOf(key);
    const next = path && fn(path, types);
    if (next && Object.keys(next[1]).length) out[tableKey(next[0])] = next[1];
  }
  return out;
}

/** Sets or clears `column`'s type in the table at `tablePath`. */
export function withNestedType(nested: NestedTypes, tablePath: CubePath, column: string, type: FrameColType | undefined): NestedTypes {
  const key = tableKey(tablePath);
  const { [column]: _old, ...rest } = nested[key] ?? {};
  const types = type ? { ...rest, [column]: type } : rest;
  const { [key]: _drop, ...others } = nested;
  return Object.keys(types).length ? { ...others, [key]: types } : others;
}

/** A column renamed in the table at `tablePath`: its pick, and every table nested in its cells, follow the name. */
export function renameNestedColumn(nested: NestedTypes, tablePath: CubePath, from: string, to: string): NestedTypes {
  const n = tablePath.length;
  return rekey(nested, (path, types) => {
    if (path.length === n && startsWith(path, tablePath)) {
      return [path, Object.fromEntries(Object.entries(types).map(([k, t]) => [k === from ? to : k, t]))];
    }
    if (startsWith(path, tablePath) && path[n + 1] === from) return [[...path.slice(0, n + 1), to, ...path.slice(n + 2)], types];
    return [path, types];
  });
}

/** A column removed from the table at `tablePath`: its pick, and every table nested in its cells, go with it. */
export function dropNestedColumn(nested: NestedTypes, tablePath: CubePath, column: string): NestedTypes {
  const n = tablePath.length;
  return rekey(nested, (path, types) => {
    if (path.length === n && startsWith(path, tablePath)) {
      const { [column]: _dropped, ...rest } = types;
      return [path, rest];
    }
    return startsWith(path, tablePath) && path[n + 1] === column ? null : [path, types];
  });
}

/** Everything typed inside the cell at `cellPath` (the cell's own table included) is dropped, as when the cell is replaced or its row removed. */
export function dropNestedUnder(nested: NestedTypes, cellPath: CubePath): NestedTypes {
  return rekey(nested, (path, types) => (startsWith(path, cellPath) ? null : [path, types]));
}
