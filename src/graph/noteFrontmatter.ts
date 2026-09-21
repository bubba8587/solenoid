// [[B1]] obsidianBet (any spelling Obsidian emits parses)
import { parseDocument, isMap, isSeq, isScalar, isPair, Scalar, type Node, type Pair, type YAMLSeq } from "yaml";
import { parseDateToSerial } from "./nodes/dateSerial";
import { typeAtRank } from "./sockets";
import { parseCx } from "./cxValue";

// The PURE frontmatter parser + type guesser. YAML is read by the `yaml` package (any
// spelling Obsidian emits or a person types), then shaped: scalars, scalar lists, and
// rows of maps → a `frame` (a `cube` when a row value is a list). Keep it graph/DOM-free.
// The frame row shape mirrors the Script node's `{name: value}` rows, so what one emits
// the other reads.

// A SUBSET of SocketDataType with IDENTICAL names, so the node maps field type → socket
// by identity (FIELD_SOCKETS in annotation.ts).
export type FrontmatterFieldType =
  | "number"
  | "string"
  | "logical"
  | "date"
  | "complex"
  | "list"
  | "strlist"
  | "logicallist"
  | "datelist"
  | "complexlist"
  | "table"
  | "strtable"
  | "logicaltable"
  | "datetable"
  | "complextable"
  | "frame"
  | "cube";

// Dates emit as serials, like the rest of Solenoid.
export type FrontmatterScalar = number | string | boolean | null;
/** A row's value may itself be a list (`after: [A, B]`) or a table (rows of its own); such rows make a cube. */
export type FrontmatterRow = { [key: string]: FrontmatterScalar | FrontmatterScalar[] | FrontmatterRow[] };
export type FrontmatterValue = FrontmatterScalar | FrontmatterScalar[] | FrontmatterScalar[][] | FrontmatterRow[];

export interface FrontmatterField {
  key: string;
  value: FrontmatterValue;
  /** Type inferred from the value (before any per-key user override). */
  guessed: FrontmatterFieldType;
  /** A frame's columns whose every present cell read as a DATE. A date is a serial by the time
   *  it is a cell, so the reader's parsed kinds are the only place this is known. */
  dateColumns?: string[];
  /** The value was a bare `{{ … }}` / `{% … %}`, which YAML reads as a flow map: the
   *  tag must be quoted to be a value. */
  knapUnquoted?: true;
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

type ScalarKind = "number" | "string" | "logical" | "date" | "complex";

/** Text that is a complex number WITH an imaginary part (`3+4i`, `-2i`); a bare `5` is a number. */
const isComplexText = (t: string): boolean => /[ij]$/.test(t) && parseCx(t) !== null;

/** Text read as an UNQUOTED YAML scalar would be: a number, true/false, an ISO date
 *  (as a serial), blank/null → null, else the text. What a rendered Knap field
 *  re-guesses by, since its render comes back inside the quotes it was written in. */
export function guessScalarText(text: string): { value: FrontmatterScalar; kind: ScalarKind } {
  const t = text.trim();
  if (t === "" || t === "~" || t === "null") return { value: null, kind: "string" };
  const lower = t.toLowerCase();
  if (lower === "true") return { value: true, kind: "logical" };
  if (lower === "false") return { value: false, kind: "logical" };
  if (NUMERIC.test(t)) return { value: Number(t), kind: "number" };
  if (DATE_ONLY.test(t)) {
    const serial = parseDateToSerial(t);
    if (Number.isFinite(serial)) return { value: Math.round(serial), kind: "date" };
  }
  if (isComplexText(t)) return { value: t, kind: "complex" };
  return { value: t, kind: "string" };
}

/** One YAML scalar node → its value + guessed kind. A quoted scalar is ALWAYS a string
 *  (`"42"`, `'true'`, `"2026-01-01"` stay text); a plain ISO date becomes a serial. */
function readScalar(node: Node | null | undefined): { value: FrontmatterScalar; kind: ScalarKind } {
  if (!isScalar(node)) return { value: node == null ? null : String(node), kind: "string" };
  const v = node.value;
  const quoted = node.type === Scalar.QUOTE_DOUBLE || node.type === Scalar.QUOTE_SINGLE;
  if (v === null || v === undefined) return { value: null, kind: "string" };
  if (typeof v === "boolean") return { value: v, kind: "logical" };
  if (typeof v === "number") return { value: Number.isFinite(v) ? v : null, kind: "number" };
  if (typeof v === "bigint") return { value: Number(v), kind: "number" };
  const s = String(v);
  if (!quoted && DATE_ONLY.test(s)) {
    const serial = parseDateToSerial(s);
    if (Number.isFinite(serial)) return { value: Math.round(serial), kind: "date" };
  }
  if (!quoted && isComplexText(s.trim())) return { value: s.trim(), kind: "complex" };
  return { value: s, kind: "string" };
}

const keyOf = (p: Pair): string => (isScalar(p.key) ? String(p.key.value ?? "") : String(p.key ?? "")).trim();

/** A map whose values are all scalars, scalar lists or nested row lists → a row; else null. */
function readRow(node: Node | null | undefined): FrontmatterRow | null {
  if (!isMap(node)) return null;
  const row: FrontmatterRow = {};
  for (const item of node.items) {
    if (!isPair(item)) continue;
    const k = keyOf(item);
    if (k === "") continue;
    const val = item.value as Node | null;
    if (isSeq(val)) {
      if (val.items.every((x) => x == null || isScalar(x))) {
        row[k] = val.items.map((x) => readScalar(x as Node | null).value);
      } else {
        const nested = val.items.map((x) => readRow(x as Node | null));
        if (!nested.every((r) => r !== null)) return null;
        row[k] = nested as FrontmatterRow[];
      }
    } else if (val == null || isScalar(val)) {
      row[k] = readScalar(val).value;
    } else {
      return null;
    }
  }
  return row;
}

/** Type a (possibly mixed) array from its first non-null element. A date is a serial by now, so
 *  the items' parsed KINDS say it: a list whose every non-null item read as a date is a date list. */
function listType(values: FrontmatterScalar[], kinds: ScalarKind[]): FrontmatterFieldType {
  const present = kinds.filter((_, i) => values[i] !== null);
  if (present.length > 0 && present.every((k) => k === "date")) return "datelist";
  // Complex cells, with plain numbers among them: a real number is a complex number too.
  if (present.some((k) => k === "complex") && present.every((k) => k === "complex" || k === "number")) return "complexlist";
  for (const v of values) {
    if (v === null) continue;
    if (typeof v === "boolean") return "logicallist";
    if (typeof v === "number") return "list";
    return "strlist";
  }
  return "list"; // empty / all-null → default numeric list (overridable)
}

/** The scalar columns of a row list whose every present cell read as a date. */
function dateColumnsOf(items: (Node | null)[]): string[] {
  const seen = new Map<string, boolean>();
  for (const item of items) {
    if (!isMap(item)) continue;
    for (const pair of item.items) {
      if (!isPair(pair)) continue;
      const k = keyOf(pair);
      const val = pair.value as Node | null;
      if (k === "" || (val != null && !isScalar(val))) { if (k !== "") seen.set(k, false); continue; }
      const { value, kind } = readScalar(val);
      if (value === null) continue;
      seen.set(k, (seen.get(k) ?? true) && kind === "date");
    }
  }
  return [...seen].filter(([, isDate]) => isDate).map(([k]) => k);
}

/** Rows → a `frame` field, or a `cube` when any row value is a list (a frame cell is
 *  scalar; a list belongs in a cube cell). */
function fieldFromRows(key: string, rows: FrontmatterRow[], items: (Node | null)[]): FrontmatterField {
  const hasList = rows.some((r) => Object.values(r).some((v) => Array.isArray(v)));
  if (hasList) return { key, value: rows, guessed: "cube" };
  const dateColumns = dateColumnsOf(items);
  return dateColumns.length ? { key, value: rows, guessed: "frame", dateColumns } : { key, value: rows, guessed: "frame" };
}

/** A sequence whose every item is a sequence of scalars → a matrix, rectangular (a short row
 *  pads with missing cells), typed like a list from all its cells; else null. */
function fieldFromMatrix(key: string, items: (Node | null)[]): FrontmatterField | null {
  if (items.length === 0 || !items.every((x) => isSeq(x) && x.items.every((c) => c == null || isScalar(c)))) return null;
  const read = items.map((row) => (row as YAMLSeq).items.map((c) => readScalar(c as Node | null)));
  const width = read.reduce((m, r) => Math.max(m, r.length), 0);
  const value = read.map((r) => Array.from({ length: width }, (_, j) => r[j]?.value ?? null));
  const flat = read.flat();
  const asList = listType(flat.map((c) => c.value), flat.map((c) => c.kind));
  return { key, value, guessed: (typeAtRank(asList, 2) ?? "strtable") as FrontmatterFieldType };
}

/** A sequence → a frame field iff EVERY item is a row; else a scalar list (a non-scalar
 *  item in a mixed list is kept as its YAML text). Empty → a scalar list. */
function fieldFromSeq(key: string, items: (Node | null)[]): FrontmatterField {
  const rows = items.map(readRow);
  if (rows.length > 0 && rows.every((r) => r !== null)) return fieldFromRows(key, rows as FrontmatterRow[], items);
  const matrix = fieldFromMatrix(key, items);
  if (matrix) return matrix;
  const read = items.map((x) => (x == null || isScalar(x) ? readScalar(x) : { value: String(x).trim(), kind: "string" as const }));
  const values = read.map((r) => r.value);
  return { key, value: values, guessed: listType(values, read.map((r) => r.kind)) };
}

function fieldOf(key: string, node: Node | null, src: string): FrontmatterField {
  if (isSeq(node)) return fieldFromSeq(key, node.items as (Node | null)[]);
  if (isMap(node)) {
    // A bare Knap tag parses as a map whose key is a map; flag it so the node can say so.
    const text = node.range ? src.slice(node.range[0], node.range[1]).trim() : "";
    if (/^\{[{%]/.test(text)) return { key, value: null, guessed: "string", knapUnquoted: true };
    // A nested map that isn't a row list has no socket shape: the key surfaces as an empty string.
    return { key, value: null, guessed: "string" };
  }
  const { value, kind } = readScalar(node);
  return { key, value, guessed: kind };
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

  const body = lines.slice(close + 1).join("\n").replace(/^\n+/, "");
  const fields: FrontmatterField[] = [];
  const seen = new Set<string>();
  const src = lines.slice(1, close).join("\n");
  let doc;
  try {
    doc = parseDocument(src, { uniqueKeys: false, schema: "core" });
  } catch {
    return { fields, body, hasBlock: true };
  }
  if (isMap(doc.contents)) {
    for (const item of doc.contents.items) {
      if (!isPair(item)) continue;
      const key = keyOf(item);
      if (key === "" || seen.has(key)) continue; // first wins on a dup key
      seen.add(key);
      fields.push(fieldOf(key, item.value as Node | null, src));
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
  // The rendered boxes index into the source, so lines marked renders as CODE (a ```/~~~
  // fence, or a 4-space block opened after a blank line outside a list) must not count.
  let count = -1;
  let fence: string | null = null;
  let prevBlank = true, prevItem = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      prevBlank = false; prevItem = false;
      continue;
    }
    if (fence !== null) continue;
    const blank = line.trim() === "";
    const indentedCode: boolean = !blank && /^(?: {4,}|\t)/.test(line) && prevBlank && !prevItem;
    const m = indentedCode ? null : marker.exec(line);
    prevBlank = blank;
    if (!blank) prevItem = indentedCode ? prevItem : /^\s*(?:[-*+]|\d+[.)])\s/.test(line);
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
