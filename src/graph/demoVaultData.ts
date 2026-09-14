// The bundled demo vault: every non-dot text file under /demo-vault as a raw string,
// keyed by its path. This module is only ever DYNAMICALLY imported (demoVault.ts), so
// Vite splits it into its own chunk — the ~150 KB of sample notes never enters the
// main bundle for users who don't turn the demo vault on. `.obsidian/` is excluded by
// extension (json/js/css), and the vault readers skip dot-folders regardless.
export const DEMO_VAULT_FILES = import.meta.glob(
  "../../demo-vault/**/*.{md,base,yaml,csv}",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;
