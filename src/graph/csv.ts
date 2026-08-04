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
