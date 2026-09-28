// [[C107]] obsidianPlugin, [[C67]] mdbaseCeiling, [[D90]] cubeTypesAtDepth
// Column types a user picked for a frame or cube property in the Solenoid Properties plugin: a pick sits above the guesser and
// only refines a table's columns (mdbase and `.obsidian/types.json` still say what a key is). Pure JSON.
import { readSchema, type CubeSchema } from "./cubeSchema";

/** A property's picks: a bare type per column, or `{ type?, columns }` where a nested table types its own. */
export type ColumnPicks = CubeSchema;
/** Keyed by property name, vault-wide, as Obsidian types a property. */
export type PluginColumnTypes = Readonly<Record<string, ColumnPicks>>;

export const PLUGIN_DATA_PATH = ".obsidian/plugins/solenoid-properties/data.json";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Anything but a real type or pick is dropped; a malformed body gives {}. */
export function parsePluginColumnTypes(text: string): PluginColumnTypes {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return {}; }
  const raw = isRecord(data) ? data.columnTypes : undefined;
  if (!isRecord(raw)) return {};
  const out: Record<string, ColumnPicks> = {};
  for (const [key, cols] of Object.entries(raw)) {
    const picks = readSchema(cols);
    if (Object.keys(picks).length) out[key] = picks;
  }
  return out;
}
