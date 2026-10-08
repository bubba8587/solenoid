// [[C107]] obsidianPlugin, [[C67]] mdbaseCeiling, [[D90]] cubeTypesAtDepth
// Column types a user picked in the Solenoid Properties plugin: a pick sits above the guesser and only refines a
// table's columns (mdbase and `.obsidian/types.json` still say what a key is). Pure JSON.
import { readColumnTypes, readNestedTables, type ColumnTypes, type NestedTables } from "./cubeTypes";

/** A frame or cube property's top-level picks, a type per column. */
export type ColumnPicks = ColumnTypes;
/** Keyed by property name, vault-wide, as Obsidian types a property. */
export type PluginColumnTypes = Readonly<Record<string, ColumnPicks>>;
/** The tables nested in one note's cube properties: note path, then property, then each table's records path. */
export type PluginNestedTables = Readonly<Record<string, Readonly<Record<string, NestedTables>>>>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readData(text: string): Record<string, unknown> {
  try { const data: unknown = JSON.parse(text); return isRecord(data) ? data : {}; } catch { return {}; }
}

/** Anything but a real type is dropped; a malformed body gives {}. */
export function parsePluginColumnTypes(text: string): PluginColumnTypes {
  const raw = readData(text).columnTypes;
  if (!isRecord(raw)) return {};
  const out: Record<string, ColumnPicks> = {};
  for (const [key, cols] of Object.entries(raw)) {
    const picks = readColumnTypes(cols);
    if (Object.keys(picks).length) out[key] = picks;
  }
  return out;
}

/** The per-cell picks of nested tables, per note; a malformed body gives {}. */
export function parsePluginNestedTables(text: string): PluginNestedTables {
  return readPluginNestedTables(readData(text).nestedTables);
}

export function readPluginNestedTables(raw: unknown): PluginNestedTables {
  const out: Record<string, Record<string, NestedTables>> = {};
  if (!isRecord(raw)) return out;
  for (const [note, props] of Object.entries(raw)) {
    if (!isRecord(props)) continue;
    const byProp: Record<string, NestedTables> = {};
    for (const [prop, nested] of Object.entries(props)) {
      const n = readNestedTables(nested);
      if (Object.keys(n).length) byProp[prop] = n;
    }
    if (Object.keys(byProp).length) out[note] = byProp;
  }
  return out;
}
