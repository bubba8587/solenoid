// [[D90]] cubeTypesAtDepth
// What is declared for each table nested in a Cube's cells, keyed by where it sits: whether it is a Frame, and its
// columns' types. Pure JSON, so Cube Input's source and the Solenoid Properties plugin's store hold it as it is.
import type { FrameColType } from "./frame";
import type { CubePath } from "./literalEditors";

/** One table's picks, a type per column. */
export type ColumnTypes = Readonly<Record<string, FrameColType>>;
/** One nested table's declarations: `frame` makes it a flat Frame, not a Cube; `types` are its columns' picks. */
export interface NestedTable { frame?: true; types?: ColumnTypes }
/** Every nested table's declarations, keyed by its records path (`tableKey`): row and key down from the top, a list index where a list holds it. */
export type NestedTables = Readonly<Record<string, NestedTable>>;

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

/** The compact entry, or nothing when it declares nothing. */
function entry(frame: boolean, types: ColumnTypes): NestedTable | undefined {
  const typed = Object.keys(types).length > 0;
  if (!frame && !typed) return undefined;
  return { ...(frame ? { frame: true as const } : {}), ...(typed ? { types } : {}) };
}

/** Keys that are not a records path, and declarations that are not a Frame flag or types, are dropped. */
export function readNestedTables(raw: unknown): NestedTables {
  const out: Record<string, NestedTable> = {};
  if (!isRecord(raw)) return out;
  for (const [key, decl] of Object.entries(raw)) {
    const path = pathOf(key);
    const e = path && isRecord(decl) ? entry(decl.frame === true, readColumnTypes(decl.types)) : undefined;
    if (path && e) out[tableKey(path)] = e;
  }
  return out;
}

export const typesAt = (nested: NestedTables, tablePath: CubePath): ColumnTypes => nested[tableKey(tablePath)]?.types ?? {};
export const isFrameAt = (nested: NestedTables, tablePath: CubePath): boolean => nested[tableKey(tablePath)]?.frame === true;

function put(nested: NestedTables, tablePath: CubePath, e: NestedTable | undefined): NestedTables {
  const key = tableKey(tablePath);
  const { [key]: _old, ...rest } = nested;
  return e ? { ...rest, [key]: e } : rest;
}

function rekey(nested: NestedTables, fn: (path: CubePath, e: NestedTable) => [CubePath, NestedTable | undefined] | null): NestedTables {
  const out: Record<string, NestedTable> = {};
  for (const [key, e] of Object.entries(nested)) {
    const path = pathOf(key);
    const next = path && fn(path, e);
    if (next && next[1]) out[tableKey(next[0])] = next[1];
  }
  return out;
}

/** Sets or clears `column`'s type in the table at `tablePath`. */
export function withNestedType(nested: NestedTables, tablePath: CubePath, column: string, type: FrameColType | undefined): NestedTables {
  const { [column]: _old, ...rest } = typesAt(nested, tablePath);
  return put(nested, tablePath, entry(isFrameAt(nested, tablePath), type ? { ...rest, [column]: type } : rest));
}

/** Marks the table at `tablePath` a Frame, or clears the mark so it reads as a Cube. */
export function withFrame(nested: NestedTables, tablePath: CubePath, frame: boolean): NestedTables {
  return put(nested, tablePath, entry(frame, typesAt(nested, tablePath)));
}

/** A column renamed in the table at `tablePath`: its pick, and every table nested in its cells, follow the name. */
export function renameNestedColumn(nested: NestedTables, tablePath: CubePath, from: string, to: string): NestedTables {
  const n = tablePath.length;
  return rekey(nested, (path, e) => {
    if (path.length === n && startsWith(path, tablePath)) {
      return [path, entry(e.frame === true, Object.fromEntries(Object.entries(e.types ?? {}).map(([k, t]) => [k === from ? to : k, t])))];
    }
    if (startsWith(path, tablePath) && path[n + 1] === from) return [[...path.slice(0, n + 1), to, ...path.slice(n + 2)], e];
    return [path, e];
  });
}

/** A column removed from the table at `tablePath`: its pick, and every table nested in its cells, go with it. */
export function dropNestedColumn(nested: NestedTables, tablePath: CubePath, column: string): NestedTables {
  const n = tablePath.length;
  return rekey(nested, (path, e) => {
    if (path.length === n && startsWith(path, tablePath)) {
      const { [column]: _dropped, ...rest } = e.types ?? {};
      return [path, entry(e.frame === true, rest)];
    }
    return startsWith(path, tablePath) && path[n + 1] === column ? null : [path, e];
  });
}

/**
 * Rows inserted or deleted in the level at `levelPath` (a records array, or a list's items): every declaration under a
 * row at or past `from` moves by `delta`. Deleting runs `dropNestedUnder` on the removed rows first.
 */
export function shiftNestedRows(nested: NestedTables, levelPath: CubePath, from: number, delta: number): NestedTables {
  const n = levelPath.length;
  return rekey(nested, (path, e) => {
    const at = path[n];
    if (path.length <= n || !startsWith(path, levelPath) || typeof at !== "number" || at < from) return [path, e];
    return [[...path.slice(0, n), at + delta, ...path.slice(n + 1)], e];
  });
}

/** Everything declared inside the cell at `cellPath` is dropped, as when its row is removed or its contents replaced; `keepOwn` keeps the cell's own table. */
export function dropNestedUnder(nested: NestedTables, cellPath: CubePath, keepOwn = false): NestedTables {
  return rekey(nested, (path, e) => (startsWith(path, cellPath) && !(keepOwn && path.length === cellPath.length) ? null : [path, e]));
}
