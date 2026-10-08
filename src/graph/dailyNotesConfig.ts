// [[B1]] obsidianBet
// The core Daily notes plugin's config: gives a Vault Folder over the daily-notes folder its default `nameFormat`, so a
// daily note's file name parses into the `date` column. Pure JSON.

export interface DailyNotesConfig {
  /** Vault-relative; "" is the vault root. */
  folder: string;
  /** Moment tokens, in formatDateSerial's token set. */
  format: string;
}

const DEFAULT: DailyNotesConfig = { folder: "", format: "YYYY-MM-DD" };

/** A malformed or absent body gives the Obsidian defaults. */
export function parseDailyNotesConfig(text: string): DailyNotesConfig {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ...DEFAULT }; }
  const o = (data ?? {}) as { folder?: unknown; format?: unknown };
  return {
    folder: typeof o.folder === "string" ? o.folder : "",
    format: typeof o.format === "string" && o.format.trim() !== "" ? o.format : "YYYY-MM-DD",
  };
}
