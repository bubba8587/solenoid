// ─── String ordering — BYTE order, not locale (decided 2026-07-12) ────────────
// When Solenoid must order two strings (the `<`/`>`/`≤`/`≥` comparisons and every
// string SORT), it compares by JS `<`/`>` on the raw string — i.e. UTF-16
// code-unit order — NOT `localeCompare`. Two reasons this is the right call here,
// even though `localeCompare` gives a "nicer" human ordering:
//
//   1. DETERMINISM. `localeCompare` depends on the host's ICU/locale data, so the
//      SAME graph could sort differently on two machines (or two browsers). Byte
//      order is a pure function of the strings — stable everywhere, forever.
//   2. BACKEND PARITY. The native Polars engine (desktop) orders strings by UTF-8
//      byte order; the JS oracle (web) must match it so a Frame Sort / Frame
//      Filter gives byte-identical results on both. `localeCompare` DIVERGES from
//      Polars (the engine.rs header already flagged this as a known gap) — byte
//      order closes it.
//
// Caveat (accepted): UTF-16 code-unit order equals UTF-8 codepoint/byte order for
// the whole BMP, so this is Polars-exact for ordinary text (ASCII, Latin,
// accented, CJK). It can differ only for astral-plane characters (U+10000+, e.g.
// some emoji), where UTF-16 surrogate pairs sort against U+E000–U+FFFF
// differently than codepoint order — an edge case we don't chase. Ordering is
// case- and accent-SENSITIVE ("Z" < "a", "e" < "é"), like a raw byte compare.
//
// Use this ONE helper everywhere a data value's string ordering is decided, so
// the two engines and the various nodes can never drift. (It does NOT govern UI
// list ordering — the Navigator, file lists, menus keep locale/natural sort.)
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
