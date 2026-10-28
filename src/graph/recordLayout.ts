// [[B11]] maximalMerge
import { wasmInvokeSync, coreImageSrc } from "./engineWasm";

export interface RecordPlacement {
  name: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  hint?: string;
  title?: boolean;
}

/** Grammar: tree/specs/computation/chart-figures.md § The Record figure. */
export function parseRecordLayout(text: string): RecordPlacement[] {
  return wasmInvokeSync<RecordPlacement[]>("engine_record_layout", { text });
}

/** A data:image URL: the one image a table grid shows in a text cell, since it fetches nothing ([[C103]] untrustedContentSeams). */
export function cellImageSrc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^data:image\//i.test(t) ? t : null;
}

/** A data:image URL, or an http(s) URL with an image extension; anything else stays text. */
export function recordImageSrc(text: string): string | null {
  return coreImageSrc(text);
}

/** The layout text that parses back to `placed` (non-overlapping rectangles): a line per grid row, a run of one
 *  name written `Name*N`, a gap `.`, a box's hint and title mark on its first cell. Rows wholly empty are dropped
 *  by the parser, so a caller compacts upward first. */
export function writeRecordLayout(placed: readonly RecordPlacement[]): string {
  const rows = Math.max(0, ...placed.map((p) => p.row + p.rowSpan - 1));
  const cols = Math.max(0, ...placed.map((p) => p.col + p.colSpan - 1));
  const grid: (RecordPlacement | null)[][] = Array.from({ length: rows }, () => Array<RecordPlacement | null>(cols).fill(null));
  for (const p of placed) {
    for (let r = p.row; r < p.row + p.rowSpan; r++) for (let c = p.col; c < p.col + p.colSpan; c++) grid[r - 1][c - 1] = p;
  }
  const written = new Set<RecordPlacement>();
  const lines: string[] = [];
  for (const line of grid) {
    if (!line.some(Boolean)) continue;
    const cells: string[] = [];
    for (let c = 0; c < cols;) {
      const p = line[c];
      let run = 1;
      while (c + run < cols && line[c + run] === p) run++;
      if (!p) cells.push(run > 1 ? `.*${run}` : ".");
      else if (!written.has(p) && (p.hint || p.title)) {
        written.add(p);
        cells.push(`${p.title ? "#" : ""}${p.name}${p.hint ? `: ${p.hint}` : ""}`);
        if (run > 1) cells.push(run > 2 ? `${p.name}*${run - 1}` : p.name);
      } else {
        written.add(p);
        cells.push(run > 1 ? `${p.name}*${run}` : p.name);
      }
      c += run;
    }
    while (cells.length > 1 && /^\.(\*\d+)?$/.test(cells[cells.length - 1])) cells.pop();
    lines.push(cells.join(" | "));
  }
  return lines.join("\n");
}
