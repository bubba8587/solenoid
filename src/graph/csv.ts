// [[C103]] untrustedContentSeams

import Papa from "papaparse";

export interface CsvOptions {
  /** Auto-detect the delimiter: off for the in-app editors (deterministic), on for file ingestion. */
  detectDelimiter?: boolean;
  /** Keep blank lines: off for file ingestion, on for a literal source, where a typed blank row is data. */
  keepBlankLines?: boolean;
}

export function parseCsvRows(text: string, opts: CsvOptions = {}): string[][] {
  // Normalize line endings first: Papa locks onto one newline type, so a stray one bleeds into the last field.
  const normalized = text.replace(/\r\n?/g, "\n");
  const result = Papa.parse<string[]>(normalized, {
    delimiter: opts.detectDelimiter ? "" : ",", // "" → Papa auto-detects
    newline: "\n",
    skipEmptyLines: opts.keepBlankLines ? false : "greedy",
  });
  const rows = result.data;
  // Papa emits a phantom [""] for a single final newline (a terminator, not a blank row); pop exactly that one.
  if (opts.keepBlankLines && normalized.endsWith("\n")) {
    const last = rows[rows.length - 1];
    if (last && last.length === 1 && last[0] === "") rows.pop();
  }
  return rows;
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
