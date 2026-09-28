// [[D90]] cubeTypesAtDepth
// The declared column types of a Cube, level by level. Pure JSON, so Cube Input's source and the
// Solenoid Properties plugin's store hold it as it is.
import type { FrameColType } from "./frame";

/** A bare type, or `{ type?, columns? }` once a table nested in the column types its own columns. */
export type ColumnPick = FrameColType | { type?: FrameColType; columns?: CubeSchema };
/** Keyed by column name. A map of bare types is a whole schema, so a flat pick list reads as one. */
export type CubeSchema = Readonly<Record<string, ColumnPick>>;

const COLUMN_TYPES: readonly FrameColType[] = ["number", "string", "date", "logical"];
export const isColumnType = (t: unknown): t is FrameColType => COLUMN_TYPES.includes(t as FrameColType);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const pickType = (p: ColumnPick | undefined): FrameColType | undefined => (typeof p === "string" ? p : p?.type);
export const pickColumns = (p: ColumnPick | undefined): CubeSchema => (typeof p === "object" && p.columns ? p.columns : {});

/** The compact pick: a bare type when nothing nested is typed, nothing when neither is. */
export function makePick(type: FrameColType | undefined, columns: CubeSchema | undefined): ColumnPick | undefined {
  if (!columns || Object.keys(columns).length === 0) return type;
  return type ? { type, columns } : { columns };
}

/** Anything but a type or a pick is dropped, at every level. */
export function readSchema(raw: unknown): CubeSchema {
  if (!isRecord(raw)) return {};
  const out: Record<string, ColumnPick> = {};
  for (const [name, p] of Object.entries(raw)) {
    const pick = isColumnType(p) ? p : isRecord(p) ? makePick(isColumnType(p.type) ? p.type : undefined, readSchema(p.columns)) : undefined;
    if (pick) out[name] = pick;
  }
  return out;
}

/** The schema of the table nested under `path`, a chain of column names from the top level. */
export function schemaAt(schema: CubeSchema, path: readonly string[]): CubeSchema {
  return path.reduce<CubeSchema>((s, name) => pickColumns(s[name]), schema);
}

function updateAt(schema: CubeSchema, path: readonly string[], fn: (level: CubeSchema) => CubeSchema): CubeSchema {
  const next: Record<string, ColumnPick> = { ...(path.length === 0 ? fn(schema) : schema) };
  if (path.length > 0) {
    const [head, ...rest] = path;
    const pick = makePick(pickType(schema[head]), updateAt(pickColumns(schema[head]), rest, fn));
    if (pick) next[head] = pick; else delete next[head];
  }
  return next;
}

/** Sets or clears `column`'s type in the table under `path`, keeping its nested types. */
export function withPickType(schema: CubeSchema, path: readonly string[], column: string, type: FrameColType | undefined): CubeSchema {
  return updateAt(schema, path, (level) => {
    const next: Record<string, ColumnPick> = { ...level };
    const pick = makePick(type, pickColumns(level[column]));
    if (pick) next[column] = pick; else delete next[column];
    return next;
  });
}

export function renamePick(schema: CubeSchema, path: readonly string[], from: string, to: string): CubeSchema {
  return updateAt(schema, path, (level) => Object.fromEntries(Object.entries(level).map(([k, p]) => [k === from ? to : k, p])));
}

export function dropPick(schema: CubeSchema, path: readonly string[], column: string): CubeSchema {
  return updateAt(schema, path, (level) => Object.fromEntries(Object.entries(level).filter(([k]) => k !== column)));
}

/** The top level's types alone, for a reader of flat tables. */
export function flatTypes(schema: CubeSchema): Record<string, FrameColType> {
  const out: Record<string, FrameColType> = {};
  for (const [name, p] of Object.entries(schema)) { const t = pickType(p); if (t) out[name] = t; }
  return out;
}
