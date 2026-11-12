// [[C1]]
export const DEMO_VAULT_FILES = import.meta.glob(
  ["../../demo-vault/**/*.{md,base,yaml,csv}", "../../demo-vault/.obsidian/{types,daily-notes}.json"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** The vault's files that aren't text (a workbook), as the address the build serves each from. */
export const DEMO_VAULT_BINARY = import.meta.glob("../../demo-vault/**/*.{xlsx,xlsm}", {
  query: "?url", import: "default", eager: true,
}) as Record<string, string>;
