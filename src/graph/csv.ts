// Shared CSV parsing. The app reads comma-separated text in several places
// (Table Input, Frame Input, the CSV-view popup, and the Web Source / CSV File
// connection). CSV is a deceptively deep format — quoted fields with embedded
// commas, doubled-quote escaping, fields that span physical lines, BOMs, CRLF,
// alternate delimiters — so rather than hand-maintain a parser we delegate to
// Papa Parse (RFC 4180, no transitive deps, synchronous). These wrappers keep a
// small `string[][]` interface so the call sites stay simple and the engine can
// be swapped without touching them.

import Papa from "papaparse";

export interface CsvOptions {
  /** Auto-detect the delimiter (comma / semicolon / tab / pipe) instead of
   *  assuming comma. The in-app comma-separated editors leave this off so their
   *  behavior is deterministic; real-world file ingestion (the CSV File / Web
   *  Source connection) turns it on so a European semicolon export still loads. */
  detectDelimiter?: boolean;
  /** Keep blank / whitespace-only lines as single-empty-field rows instead of
   *  dropping them. File ingestion wants them GONE (the default); a LITERAL
   *  source whose raw text is the stored truth (Table Input) wants them KEPT —
   *  a blank row the user typed is data (a row of missing cells), and dropping
   *  it here silently deleted it from the Source on the next popup save. */
  keepBlankLines?: boolean;
}

/** Parse CSV text into rows of string fields. Blank lines are dropped (unless
 *  `keepBlankLines`); quotes, embedded commas, doubled-quote escapes, embedded
 *  newlines, CRLF, and a leading BOM are all handled. Cells stay strings —
 *  callers do their own numeric coercion. */
export function parseCsvRows(text: string, opts: CsvOptions = {}): string[][] {
  // Normalize line endings first so a file with MIXED endings (CRLF rows but a
  // bare-LF final line, say) parses cleanly — Papa locks onto a single newline
  // type, so a stray ending would otherwise bleed into the last field.
  const normalized = text.replace(/\r\n?/g, "\n");
  const result = Papa.parse<string[]>(normalized, {
    delimiter: opts.detectDelimiter ? "" : ",", // "" → Papa auto-detects
    newline: "\n",
    skipEmptyLines: opts.keepBlankLines ? false : "greedy",
    // header:false, dynamicTyping:false are the defaults — we want raw rows.
  });
  const rows = result.data;
  // keepBlankLines: a single FINAL newline is a line TERMINATOR, not a blank row
  // — Papa emits a phantom [""] for it ("1,2\n" → 2 rows). Pop exactly that one;
  // deliberately typed blank lines (even trailing: "1,2\n\n") stay as rows.
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
