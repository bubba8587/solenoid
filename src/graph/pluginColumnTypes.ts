// [[C107]] obsidianPlugin, [[C67]] mdbaseCeiling
// The column types a user PICKED for a frame property in the Solenoid Properties plugin,
// kept in the plugin's own data (`columnTypes`: property → column → type, the app's own type
// names). A pick is the end of guessing for that column: it sits above the guesser, and it
// only refines a frame's columns (mdbase and `.obsidian/types.json` still say what a key IS).
// Pure JSON; graph/DOM-free.
import type { FrameColType } from "./frame";

/** One property's picks: column name → type. */
export type ColumnPicks = Readonly<Record<string, FrameColType>>;
/** Every property's picks, by the property's name (vault-wide, as Obsidian types a property). */
export type PluginColumnTypes = Readonly<Record<string, ColumnPicks>>;

/** Where the plugin keeps its data, vault-relative. */
export const PLUGIN_DATA_PATH = ".obsidian/plugins/solenoid-properties/data.json";

const COLUMN_TYPES: readonly FrameColType[] = ["number", "string", "date", "logical"];
const isColumnType = (t: unknown): t is FrameColType => COLUMN_TYPES.includes(t as FrameColType);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse the plugin's `data.json` text into picks. Anything but a real type is dropped; a
 *  malformed body → {}. */
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
