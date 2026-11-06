// [[C114]] cardsView, [[C103]] untrustedContentSeams
import { wasmInvokeSync, coreIsHexColor, coreLinkHref } from "./engineWasm";
import { formatFrameCell, type FrameValue } from "./frame";

export type CardColType = "number" | "string" | "date" | "logical";

export interface CardColumnInput {
  name: string;
  type: CardColType;
  /** The raw text of each row's cell, in source order; blank is "". */
  cells: readonly string[];
  /** Each row's cell as the popup shows it (format picks applied), when it differs from `cells`. */
  shown?: readonly string[];
  /** The column's format is the Chip style. */
  chip?: boolean;
  /** Every filled cell is a nested list, table, Frame or Cube; `lists` when every one is a list. */
  nested?: boolean;
  lists?: boolean;
}

interface CardMeter { col: number; max: number }

/** Column indices by the part of the card they fill; every column lands in exactly one part. */
export interface CardPlan {
  image: number | null;
  key: number | null;
  title: number | null;
  /** Columns joined after the title with a space: a Last Name after a First Name. */
  titleRest: number[];
  subtitle: number | null;
  meta: number | null;
  /** The end of a date range whose start is `meta`. */
  metaEnd: number | null;
  hero: number | null;
  chips: number[];
  tags: number[];
  swatches: number[];
  flags: number[];
  ratings: number[];
  meters: CardMeter[];
  stats: number[];
  prose: number[];
}

// The profile reads a bounded prefix, so opening a huge frame stays cheap; the plan is still a pure function of the cells.
export const PROFILE_ROWS = 2000;

const TAG_SPLIT = /\s*[,;]\s*/;

export function isHexColor(text: string): boolean {
  return coreIsHexColor(text);
}

export function splitTags(text: string): string[] {
  return text.split(TAG_SPLIT).map((t) => t.trim()).filter((t) => t !== "");
}

/** The address a cell's text links to: an http(s) URL as it is, an email address as `mailto:`; anything else null. */
export function linkHref(text: string): string | null {
  return coreLinkHref(text);
}

/** A URL shortened for a narrow card: no scheme, no `www.`, no trailing slash, and a long path cut to its first part. */
export function shortLink(url: string): string {
  const bare = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  if (bare.length <= 32) return bare;
  const slash = bare.indexOf("/");
  if (slash < 0) return bare.slice(0, 31) + "…";
  const host = bare.slice(0, slash);
  const firstPart = bare.slice(slash + 1).split(/[/?#]/)[0];
  const short = firstPart ? `${host}/${firstPart}` : host;
  return short.length < bare.length ? `${short.slice(0, 31)}…` : short;
}

/** The Cards view's plan for a table's columns ([[C114]] cardsView), the one the Record card draws too. */
export function planCards(cols: readonly CardColumnInput[]): CardPlan {
  return wasmInvokeSync<CardPlan>("engine_plan_cards", { cols });
}

/** A Record layout written from the data ([[D111]] cardLayouts), `units` grid columns wide: what a form or card with no
 *  authored layout uses, and what the layout fields' Suggest writes out. */
export function suggestRecordLayout(cols: readonly CardColumnInput[], units: number): string {
  return wasmInvokeSync<string>("engine_plan_cards", { cols, units });
}

/** `suggestRecordLayout` for a Frame value as it reads (a Frame Input's output, or the frame on a Record's cable). */
export function suggestFrameLayout(f: FrameValue, units: number): string {
  const rows = Math.min(f.columns.reduce((m, c) => Math.max(m, c.values.length), 0), PROFILE_ROWS);
  return suggestRecordLayout(f.columns.map((col) => ({
    name: col.name,
    type: col.type,
    cells: Array.from({ length: rows }, (_, r) => { const v = formatFrameCell(col.type, col.values[r] ?? null); return v === null ? "" : String(v); }),
  })), units);
}

export function cardMatches(texts: readonly string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = texts.join("\u0001").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}
