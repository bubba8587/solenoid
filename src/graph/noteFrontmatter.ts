import { parseDateToSerial } from "./nodes/date";

// ─── Note frontmatter → typed fields ──────────────────────────────────────────
// A Note's markdown body may open with an Obsidian-style YAML frontmatter block
// (between `---` fences at the very top). Each key becomes a typed OUTPUT socket
// so a Note doubles as a lightweight typed-record / constants source the graph
// pulls from. This module is the PURE parser + type guesser: it turns the body
// text into ordered fields (key, parsed value, guessed type) and the remaining
// markdown body. The NoteNode owns the socket lifecycle + per-key type overrides;
// the component renders the sockets. No graph/DOM deps here — fully unit-tested.
//
// We parse a deliberately small YAML subset (the constants-source shape): scalar
// `key: value`, inline flow arrays `key: [a, b]`, and block lists (`- item` lines
// under a bare `key:`). Nested maps / arrays-of-maps (→ table/frame) are deferred.

// The field types a frontmatter value can guess to. A SUBSET of SocketDataType
// (the names are identical ON PURPOSE) so the node maps a field type to a socket
// by identity (FIELD_SOCKETS in annotation.ts) — scalars + 1-D lists; 2-D
// table/frame come later with nested maps.
export type FrontmatterFieldType =
  | "number"
  | "string"
  | "logical"
  | "date"
  | "list"
  | "strlist"
  | "logicallist"
  | "datelist";

// The value a field emits on its output — dates are serials (numbers), like the
// rest of Solenoid. A list carries the element values (possibly mixed / null).
export type FrontmatterScalar = number | string | boolean | null;
export type FrontmatterValue = FrontmatterScalar | FrontmatterScalar[];

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
  // Quoted → always a string (strip the matching quotes; no escape handling needed
  // for a constants source).
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

/** Split a flow-array body (`a, b, "c, d"`) on TOP-LEVEL commas, honoring quotes. */
function splitFlow(inner: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (const ch of inner) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ",") {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim() !== "" || out.length > 0) out.push(buf);
  return out;
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

/**
 * Parse a note body. Returns its frontmatter fields (typed) and the markdown body
 * below the block. With no valid top-of-file `---…---` block, `fields` is empty,
 * `body` is the input unchanged, and `hasBlock` is false.
 */
export function parseNoteFrontmatter(text: string): ParsedFrontmatter {
  const lines = text.split("\n");
  // The block must open on the very first line (Obsidian rule). A lone leading
  // blank line or anything else means "no frontmatter".
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
    // Block-list items belonging to the previous key are consumed by it below,
    // so a stray `- item` at top level (no owning key) is ignored.
    const m = /^([A-Za-z0-9_][\w .-]*?)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const rest = m[2];
    if (key === "" || seen.has(key)) continue; // first wins on a dup key
    seen.add(key);

    if (rest.trim() === "") {
      // Either a bare `key:` introducing a block list, or an empty value. Look
      // ahead for `- item` lines.
      const items: FrontmatterScalar[] = [];
      let j = i + 1;
      for (; j < yamlLines.length; j++) {
        const lm = /^\s*-\s+(.*)$/.exec(yamlLines[j]);
        if (!lm) break;
        items.push(parseScalar(lm[1]).value);
      }
      if (items.length > 0) {
        fields.push(fieldFromArray(key, items));
        i = j - 1;
      } else {
        fields.push({ key, value: null, guessed: "string" });
      }
      continue;
    }

    const trimmed = rest.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const inner = trimmed.slice(1, -1);
      const values =
        inner.trim() === "" ? [] : splitFlow(inner).map((s) => parseScalar(s).value);
      fields.push(fieldFromArray(key, values));
    } else {
      fields.push(fieldFromScalar(key, rest));
    }
  }

  return { fields, body, hasBlock: true };
}
