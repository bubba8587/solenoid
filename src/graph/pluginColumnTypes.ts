// [[C107]] obsidianPlugin, [[C67]] mdbaseCeiling
// Column types a user picked for a frame property in the Solenoid Properties plugin: a pick sits above the guesser and
// only refines a frame's columns (mdbase and `.obsidian/types.json` still say what a key is). Pure JSON.
import type { FrameColType } from "./frame";

export type ColumnPicks = Readonly<Record<string, FrameColType>>;
/** Keyed by property name, vault-wide, as Obsidian types a property. */
export type PluginColumnTypes = Readonly<Record<string, ColumnPicks>>;

export const PLUGIN_DATA_PATH = ".obsidian/plugins/solenoid-properties/data.json";

const COLUMN_TYPES: readonly FrameColType[] = ["number", "string", "date", "logical"];
const isColumnType = (t: unknown): t is FrameColType => COLUMN_TYPES.includes(t as FrameColType);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Anything but a real type is dropped; a malformed body gives {}. */
export function parsePluginColumnTypes(text: string): PluginColumnTypes {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return {}; }
  const raw = isRecord(data) ? data.columnTypes : undefined;
  if (!isRecord(raw)) return {};
  const out: Record<string, ColumnPicks> = {};
  for (const [key, cols] of Object.entries(raw)) {
    if (!isRecord(cols)) continue;
    const picks: Record<string, FrameColType> = {};
    for (const [name, t] of Object.entries(cols)) if (isColumnType(t)) picks[name] = t;
    if (Object.keys(picks).length) out[key] = picks;
  }
  return out;
}
