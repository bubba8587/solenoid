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
