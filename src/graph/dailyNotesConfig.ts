// `.obsidian/daily-notes.json` — the core Daily notes plugin's config. Gives the Vault
// Folder its default `nameFormat` (R3) when its folder IS the daily-notes folder, so a
// daily note's file name parses into the `date` column. Pure JSON; graph/DOM-free.

export interface DailyNotesConfig {
  /** Vault-relative folder daily notes live in ("" = vault root). */
  folder: string;
  /** Moment-token file-name format (Solenoid's formatDateSerial token set). */
  format: string;
}

const DEFAULT: DailyNotesConfig = { folder: "", format: "YYYY-MM-DD" };

/** Parse `.obsidian/daily-notes.json`; a malformed/absent body → the Obsidian defaults. */
export function parseDailyNotesConfig(text: string): DailyNotesConfig {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ...DEFAULT }; }
  const o = (data ?? {}) as { folder?: unknown; format?: unknown };
  return {
    folder: typeof o.folder === "string" ? o.folder : "",
    format: typeof o.format === "string" && o.format.trim() !== "" ? o.format : "YYYY-MM-DD",
  };
}
