// [[C103]] untrustedContentSeams
// Shared CSV parsing — delegates to Papa Parse (RFC 4180, synchronous) behind a
// small `string[][]` interface, so the engine can be swapped at one site.

import Papa from "papaparse";

export interface CsvOptions {
  /** Auto-detect the delimiter instead of assuming comma: OFF for the in-app
   *  editors (deterministic), ON for file ingestion. */
  detectDelimiter?: boolean;
  /** Keep blank lines as single-empty-field rows: OFF for file ingestion, ON for a
   *  LITERAL source whose raw text is the stored truth — a typed blank row is data. */
  keepBlankLines?: boolean;
}

/** Parse CSV text into rows of string fields; cells stay STRINGS — callers do
 *  their own numeric coercion. */
export function parseCsvRows(text: string, opts: CsvOptions = {}): string[][] {
  // Normalize line endings first: Papa locks onto ONE newline type, so in a file
  // with mixed endings a stray one bleeds into the last field.
  const normalized = text.replace(/\r\n?/g, "\n");
  const result = Papa.parse<string[]>(normalized, {
    delimiter: opts.detectDelimiter ? "" : ",", // "" → Papa auto-detects
    newline: "\n",
    skipEmptyLines: opts.keepBlankLines ? false : "greedy",
  });
  const rows = result.data;
  // A single FINAL newline is a TERMINATOR, not a blank row, but Papa emits a
  // phantom [""] for it; pop exactly that one, keeping typed blank lines.
  if (opts.keepBlankLines && normalized.endsWith("\n")) {
    const last = rows[rows.length - 1];
    if (last && last.length === 1 && last[0] === "") rows.pop();
  }
  return rows;
}

/** Parse a single CSV line into its fields (the first row of the text). */
export function parseCsvLine(line: string, opts: CsvOptions = {}): string[] {
  return parseCsvRows(line, opts)[0] ?? [""];
}

/** Where each field sits in comma-delimited text: `[start, end)` offsets with the
 *  field's row and column, quotes included. A quoted field may hold commas and
 *  newlines (RFC 4180, `""` = a literal quote); `\r\n` and `\r` end a row like `\n`.
 *  For an editor that marks fields in place — never a parser (see `parseCsvRows`). */
export interface CsvFieldSpan { start: number; end: number; row: number; col: number }
export function csvFieldSpans(text: string): CsvFieldSpan[] {
  const spans: CsvFieldSpan[] = [];
  let row = 0, col = 0, start = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') i++; else quoted = false; }
      continue;
    }
    if (ch === '"' && i === start) { quoted = true; continue; }
    if (ch === ",") { spans.push({ start, end: i, row, col }); col++; start = i + 1; continue; }
    if (ch === "\n" || ch === "\r") {
      spans.push({ start, end: i, row, col });
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row++; col = 0; start = i + 1;
    }
  }
  // A final newline is a terminator, not an empty last row.
  if (start < text.length || col > 0) spans.push({ start, end: text.length, row, col });
  return spans;
}
