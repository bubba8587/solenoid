// ─── String ordering — BYTE order, not locale ─────────────────────────────────
// Every DATA-value string ordering (the `<`/`>`/`≤`/`≥` comparisons and every
// string SORT) goes through this ONE helper: JS `<`/`>` on the raw string (UTF-16
// code-unit order), never `localeCompare` — that would diverge from the native
// Polars engine's UTF-8 byte order and vary with the host's ICU data. Ordering is
// case- and accent-SENSITIVE ("Z" < "a", "e" < "é"). It does NOT govern UI list
// ordering — the Navigator, file lists and menus keep locale/natural sort.
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
