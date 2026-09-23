// [[C1]]
export const DEMO_VAULT_FILES = import.meta.glob(
  "../../demo-vault/**/*.{md,base,yaml,csv}",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;
