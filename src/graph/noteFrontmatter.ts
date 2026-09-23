// [[B1]] obsidianBet (any spelling Obsidian emits parses)
import { parseDocument, isMap, isSeq, isScalar, isPair, Scalar, type Node, type Pair, type YAMLSeq } from "yaml";
import { parseDateToSerial } from "./nodes/dateSerial";
import { typeAtRank } from "./sockets";
import { parseCx } from "./cxValue";


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

export type FrontmatterScalar = number | string | boolean | null;
export type FrontmatterRow = { [key: string]: FrontmatterScalar | FrontmatterScalar[] | FrontmatterRow[] };
export type FrontmatterValue = FrontmatterScalar | FrontmatterScalar[] | FrontmatterScalar[][] | FrontmatterRow[];

export interface FrontmatterField {
  key: string;
  value: FrontmatterValue;
  guessed: FrontmatterFieldType;
  dateColumns?: string[];
  knapUnquoted?: true;
}

export interface ParsedFrontmatter {
  fields: FrontmatterField[];
  body: string;
  hasBlock: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

type ScalarKind = "number" | "string" | "logical" | "date" | "complex";

const isComplexText = (t: string): boolean => /[ij]$/.test(t) && parseCx(t) !== null;

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

function readScalar(node: Node | null | undefined): { value: FrontmatterScalar; kind: ScalarKind; text?: string } {
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
    if (Number.isFinite(serial)) return { value: Math.round(serial), kind: "date", text: s };
  }
  if (!quoted && isComplexText(s.trim())) return { value: s.trim(), kind: "complex" };
  return { value: s, kind: "string" };
}

const keyOf = (p: Pair): string => (isScalar(p.key) ? String(p.key.value ?? "") : String(p.key ?? "")).trim();

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
      const { value, kind } = readScalar(val);
      row[k] = kind === "date" && isScalar(val) ? String(val.value) : value;
    } else {
      return null;
    }
  }
  return row;
}

/** Mixed families are text, never typed by the first element, so no element is coerced away ([[B17]] typedValueModel). */
function listType(values: FrontmatterScalar[], kinds: ScalarKind[]): FrontmatterFieldType {
  const present = kinds.filter((_, i) => values[i] !== null);
  if (present.length === 0) return "list";
  if (present.every((k) => k === "date")) return "datelist";
  if (present.some((k) => k === "complex") && present.every((k) => k === "complex" || k === "number")) return "complexlist";
  if (present.every((k) => k === "logical")) return "logicallist";
  if (present.every((k) => k === "number" || k === "date")) return "list";
  return "strlist";
}

type Read = { value: FrontmatterScalar; kind: ScalarKind; text?: string };

/** In a text list a date keeps the text written, not its serial. */
const asElement = (r: Read, family: FrontmatterFieldType): FrontmatterScalar =>
  r.kind === "date" && (family === "strlist" || family === "strtable") ? (r.text ?? r.value) : r.value;

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

function fieldFromRows(key: string, rows: FrontmatterRow[], items: (Node | null)[]): FrontmatterField {
  const hasList = rows.some((r) => Object.values(r).some((v) => Array.isArray(v)));
  if (hasList) return { key, value: rows, guessed: "cube" };
  const dateColumns = dateColumnsOf(items);
  return dateColumns.length ? { key, value: rows, guessed: "frame", dateColumns } : { key, value: rows, guessed: "frame" };
}

function fieldFromMatrix(key: string, items: (Node | null)[]): FrontmatterField | null {
  if (items.length === 0 || !items.every((x) => isSeq(x) && x.items.every((c) => c == null || isScalar(c)))) return null;
  const read = items.map((row) => (row as YAMLSeq).items.map((c) => readScalar(c as Node | null)));
  const width = read.reduce((m, r) => Math.max(m, r.length), 0);
  const flat = read.flat();
  const guessed = (typeAtRank(listType(flat.map((c) => c.value), flat.map((c) => c.kind)), 2) ?? "strtable") as FrontmatterFieldType;
  const value = read.map((r) => Array.from({ length: width }, (_, j) => (r[j] ? asElement(r[j], guessed) : null)));
  return { key, value, guessed };
}

function fieldFromSeq(key: string, items: (Node | null)[]): FrontmatterField {
  const rows = items.map(readRow);
  if (rows.length > 0 && rows.every((r) => r !== null)) return fieldFromRows(key, rows as FrontmatterRow[], items);
  const matrix = fieldFromMatrix(key, items);
  if (matrix) return matrix;
  const read: Read[] = items.map((x) => (x == null || isScalar(x) ? readScalar(x) : { value: String(x).trim(), kind: "string" as const }));
  const guessed = listType(read.map((r) => r.value), read.map((r) => r.kind));
  return { key, value: read.map((r) => asElement(r, guessed)), guessed };
}

function fieldOf(key: string, node: Node | null, src: string): FrontmatterField {
  if (isSeq(node)) return fieldFromSeq(key, node.items as (Node | null)[]);
  if (isMap(node)) {
    const text = node.range ? src.slice(node.range[0], node.range[1]).trim() : "";
    if (/^\{[{%]/.test(text)) return { key, value: null, guessed: "string", knapUnquoted: true };
    return { key, value: null, guessed: "string" };
  }
  const { value, kind } = readScalar(node);
  return { key, value, guessed: kind };
}

export function parseNoteFrontmatter(text: string): ParsedFrontmatter {
  const lines = text.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { fields: [], body: text, hasBlock: false };
  }
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
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      fields.push(fieldOf(key, item.value as Node | null, src));
    }
  }
  return { fields, body, hasBlock: true };
}

export function toggleTaskMarker(body: string, index: number): string {
  const lines = body.split("\n");
  let start = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") { start = i + 1; break; }
    }
  }
  const marker = /^(\s*[-*+]\s+)\[([ xX])\](?=\s|$)/;
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
