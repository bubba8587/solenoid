import { parseDateToSerial } from "./nodes/dateSerial";

// The PURE frontmatter parser + type guesser, over a deliberately small YAML subset:
// scalar `key: value`, inline flow arrays, block lists, and rows of inline objects
// (`- {k: v}` block or `[{k: v}, …]` flow) → a `frame`. Keep it graph/DOM-free. The frame
// row shape mirrors the Script node's `{name: value}` rows, so what one emits the other reads.

// A SUBSET of SocketDataType with IDENTICAL names, so the node maps field type → socket
// by identity (FIELD_SOCKETS in annotation.ts).
export type FrontmatterFieldType =
  | "number"
  | "string"
  | "logical"
  | "date"
  | "list"
  | "strlist"
  | "logicallist"
  | "datelist"
  | "frame";

// Dates emit as serials, like the rest of Solenoid.
export type FrontmatterScalar = number | string | boolean | null;
export type FrontmatterRow = Record<string, FrontmatterScalar>;
export type FrontmatterValue = FrontmatterScalar | FrontmatterScalar[] | FrontmatterRow[];

export interface FrontmatterField {
  key: string;
  value: FrontmatterValue;
  /** Type inferred from the value (before any per-key user override). */
  guessed: FrontmatterFieldType;
}

export interface ParsedFrontmatter {
  /** Ordered fields in source order. Empty when there is no valid block. */
  fields: FrontmatterField[];
  /** The markdown body AFTER the closing fence (what the note renders). */
  body: string;
  /** True iff a well-formed `---`-fenced block was found at the very top. */
  hasBlock: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// A plain (unquoted) numeric token: optional sign, digits, optional fraction, exp.
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

type ScalarKind = "number" | "string" | "logical" | "date";

/** Parse one scalar token to its value + guessed scalar kind. */
function parseScalar(raw: string): { value: FrontmatterScalar; kind: ScalarKind } {
  const t = raw.trim();
  if (t === "" || t === "~" || t === "null") return { value: null, kind: "string" };
  // Quoted → ALWAYS a string; no escape handling needed for a constants source.
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return { value: t.slice(1, -1), kind: "string" };
  }
  const lower = t.toLowerCase();
  if (lower === "true") return { value: true, kind: "logical" };
  if (lower === "false") return { value: false, kind: "logical" };
  if (NUMERIC.test(t)) return { value: Number(t), kind: "number" };
  if (DATE_ONLY.test(t)) {
    const serial = parseDateToSerial(t);
    if (Number.isFinite(serial)) return { value: Math.round(serial), kind: "date" };
  }
  return { value: t, kind: "string" };
}

/** Split a flow body (`a, b, "c, d"`, or `{k: v}, {k: v}`) on TOP-LEVEL commas, honoring
 *  quotes AND `{…}` object nesting so a comma inside a row object doesn't split it. */
function splitFlow(inner: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  let depth = 0;
  for (const ch of inner) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === "{") {
      depth++;
      buf += ch;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      buf += ch;
    } else if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim() !== "" || out.length > 0) out.push(buf);
  return out;
}

/** `{k: v, k: v}` → a row object; null when the token isn't a brace-wrapped inline map.
 *  Keys split on the FIRST colon; values run through the same scalar parser as everything. */
function parseInlineObject(raw: string): FrontmatterRow | null {
  const t = raw.trim();
  if (!(t.startsWith("{") && t.endsWith("}"))) return null;
  const inner = t.slice(1, -1).trim();
  const row: FrontmatterRow = {};
  if (inner === "") return row;
  for (const part of splitFlow(inner)) {
    const c = part.indexOf(":");
    if (c < 0) continue;
    const k = part.slice(0, c).trim();
    if (k === "") continue;
    row[k] = parseScalar(part.slice(c + 1)).value;
  }
  return row;
}

/** Type a (possibly mixed) array from its first non-null element. */
function listType(values: FrontmatterScalar[]): FrontmatterFieldType {
  for (const v of values) {
    if (v === null) continue;
    if (typeof v === "boolean") return "logicallist";
    if (typeof v === "number") return "list"; // dates already collapsed to numbers
    return "strlist";
  }
  return "list"; // empty / all-null → default numeric list (overridable)
}

function fieldFromScalar(key: string, raw: string): FrontmatterField {
  const { value, kind } = parseScalar(raw);
  return { key, value, guessed: kind === "string" ? "string" : kind };
}

function fieldFromArray(key: string, values: FrontmatterScalar[]): FrontmatterField {
  // A date inside an array stays a serial number, so the list types as `list`.
  return { key, value: values, guessed: listType(values) };
}

/** Rows of inline objects → a `frame` field; the node builds the columns from the keys. */
function fieldFromRows(key: string, rows: FrontmatterRow[]): FrontmatterField {
  return { key, value: rows, guessed: "frame" };
}

/** Items (flow or block) → a frame field iff EVERY item is an inline object; else a scalar
 *  array. Empty → a scalar array (an empty frame would have no columns). */
function fieldFromItems(key: string, items: string[]): FrontmatterField {
  const rows = items.map(parseInlineObject);
  if (rows.length > 0 && rows.every((r) => r !== null)) return fieldFromRows(key, rows as FrontmatterRow[]);
  return fieldFromArray(key, items.map((s) => parseScalar(s).value));
}

/** With no valid top-of-file `---…---` block: no fields, `body` unchanged, `hasBlock` false. */
export function parseNoteFrontmatter(text: string): ParsedFrontmatter {
  const lines = text.split("\n");
  // The block must open on the very FIRST line (Obsidian rule).
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { fields: [], body: text, hasBlock: false };
  }
  // Find the closing fence. Unterminated → not frontmatter (body unchanged).
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { close = i; break; }
  }
  if (close === -1) return { fields: [], body: text, hasBlock: false };

  const yamlLines = lines.slice(1, close);
  const body = lines.slice(close + 1).join("\n").replace(/^\n+/, "");

  const fields: FrontmatterField[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < yamlLines.length; i++) {
    const line = yamlLines[i];
    if (line.trim() === "") continue;
    // A stray `- item` with no owning key is ignored — owned ones are consumed below.
    const m = /^([A-Za-z0-9_][\w .-]*?)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const rest = m[2];
    if (key === "" || seen.has(key)) continue; // first wins on a dup key
    seen.add(key);

    if (rest.trim() === "") {
      // A bare `key:` may introduce a block list, so look ahead for `- item` lines.
      const items: string[] = [];
      let j = i + 1;
      for (; j < yamlLines.length; j++) {
        const lm = /^\s*-\s+(.*)$/.exec(yamlLines[j]);
        if (!lm) break;
        items.push(lm[1]);
      }
      if (items.length > 0) {
        fields.push(fieldFromItems(key, items));
        i = j - 1;
      } else {
        fields.push({ key, value: null, guessed: "string" });
      }
      continue;
    }

    const trimmed = rest.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const inner = trimmed.slice(1, -1);
      const items = inner.trim() === "" ? [] : splitFlow(inner);
      fields.push(fieldFromItems(key, items));
    } else {
      fields.push(fieldFromScalar(key, rest));
    }
  }

  return { fields, body, hasBlock: true };
}

/** Toggle the Nth GFM task marker (`- [ ]` ⇄ `- [x]`) in a note body, counting only
 *  markers BELOW any frontmatter block so the index — taken from the RENDERED body,
 *  which has the frontmatter stripped — lines up with the source. Pure. */
export function toggleTaskMarker(body: string, index: number): string {
  const lines = body.split("\n");
  // Skip a top-of-file `---…---` block, mirroring parseNoteFrontmatter's boundary.
  let start = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") { start = i + 1; break; }
    }
  }
  // The exact shape `marked` treats as a checkbox: a bullet item whose text opens
  // with `[ ]`/`[x]` followed by a space or the line end.
  const marker = /^(\s*[-*+]\s+)\[([ xX])\](?=\s|$)/;
  let count = -1;
  for (let i = start; i < lines.length; i++) {
    const m = marker.exec(lines[i]);
    if (!m) continue;
    count++;
    if (count === index) {
      const checked = m[2].toLowerCase() === "x";
      lines[i] = m[1] + (checked ? "[ ]" : "[x]") + lines[i].slice(m[0].length);
      break;
    }
  }
  return lines.join("\n");
}
