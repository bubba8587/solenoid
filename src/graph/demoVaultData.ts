// [[B1]] obsidianBet, [[vault-read#Which notes are read]]
export const DEMO_VAULT_FILES = import.meta.glob(
  ["../../demo-vault/**/*.{md,base,yaml,csv,html,css}", "../../demo-vault/.obsidian/{types,daily-notes}.json"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** The vault's files that aren't text (a workbook, a picture, a font), as the address the build serves each from. */
export const DEMO_VAULT_BINARY = import.meta.glob("../../demo-vault/**/*.{xlsx,xlsm,png,jpg,jpeg,gif,webp,avif,svg,woff2,woff,ttf,otf}", {
  query: "?url", import: "default", eager: true,
}) as Record<string, string>;
