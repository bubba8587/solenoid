// [[C103]] untrustedContentSeams

import { wasmCsvRows, wasmInvokeSync } from "./engineWasm";

export interface CsvOptions {
  /** Auto-detect the delimiter: off for the in-app editors (deterministic), on for file ingestion. */
  detectDelimiter?: boolean;
  /** Keep blank lines: off for file ingestion, on for a literal source, where a typed blank row is data. */
  keepBlankLines?: boolean;
}

/** Every row the text reads as, on the core (`csv.rs`, the `csv` crate): `\r\n` and `\r` read as `\n`, a leading BOM
 *  dropped, a final newline a terminator. */
export function parseCsvRows(text: string, opts: CsvOptions = {}): string[][] {
  return wasmCsvRows(text, !!opts.detectDelimiter, !!opts.keepBlankLines);
}

/** Rows as CSV text with a header row, on the core: a field holding a comma, quote or line break quoted; every line
 *  ended by `\r\n`. */
export function unparseCsv(fields: readonly string[], rows: readonly (readonly string[])[]): string {
  return wasmInvokeSync<string>("engine_csv_text", { fields, rows });
}

/** Rows of already-escaped fields as CSV text. A row that is one blank field writes as `""`: an empty line would read back as the final newline's phantom, and the row would drop. */
export function joinCsvRows(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.join(",") || '""').join("\n");
}

export function parseCsvLine(line: string, opts: CsvOptions = {}): string[] {
  return parseCsvRows(line, opts)[0] ?? [""];
}

/** Field offsets `[start, end)` with row and column, quotes included, for an editor that marks fields in place; never a parser. */
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
