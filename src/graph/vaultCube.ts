// [[C67]]
import {
  cubeFromColumns, recordsToCube,
  type CubeValue, type CubeCell, type FrameColType,
} from "./frame";
import { parseNoteFrontmatter, isoDateText, type FrontmatterScalar, type FrontmatterRow } from "./noteFrontmatter";
import { parseDate } from "./nodes/dateSerial";
import { type TypeHint, type TypeMap, type ScalarKind } from "./vaultTypes";
import type { PluginColumnTypes, ColumnPicks } from "./pluginColumnTypes";

export interface VaultNote {
  path: string;
  text: string;
  mtimeMs?: number | null;
  birthtimeMs?: number | null;
  size?: number | null;
}

export interface VaultTypeSources {
  mdbaseFor: (path: string) => TypeMap;
  obsidian: TypeMap;
  columns?: PluginColumnTypes;
}

export interface VaultCubeOptions {
  nameFormat?: string;
  includeBody?: boolean;
}

const MS_PER_DAY = 86400000;
const EPOCH_OFFSET = 25569;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

const msToSerial = (ms: number | null | undefined): number | null =>
  typeof ms === "number" && Number.isFinite(ms) ? ms / MS_PER_DAY + EPOCH_OFFSET : null;

function utf8Bytes(s: string): number {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length;
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;
const EMBED = /!\[\[([^\]]+)\]\]/g;
const INLINE_TAG = /(?:^|\s)#([A-Za-z0-9_][\w/-]*)/g;

function linkTarget(inner: string): string {
  return inner.split("|")[0].split("#")[0].trim();
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (v === "" || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function extractLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WIKILINK)) out.push(linkTarget(m[1]));
  return uniqueInOrder(out);
}
function extractEmbeds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(EMBED)) out.push(linkTarget(m[1]));
  return uniqueInOrder(out);
}
export function extractInlineTags(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(INLINE_TAG)) out.push(m[1]);
  return out;
}

const NAME_TOKEN = /YYYY|YY|MM|M|DD|D|HH|mm|ss/g;

export function dateFromName(name: string, format: string): number | null {
  if (!format) return null;
  const fields: string[] = [];
  let re = "";
  let last = 0;
  for (const m of format.matchAll(NAME_TOKEN)) {
    const idx = m.index ?? 0;
    re += format.slice(last, idx).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    last = idx + m[0].length;
    const tok = m[0];
    fields.push(tok);
    re += tok === "YYYY" ? "(\\d{4})"
      : tok === "YY" ? "(\\d{2})"
      : tok === "MM" || tok === "DD" || tok === "HH" || tok === "mm" || tok === "ss" ? "(\\d{2})"
      : "(\\d{1,2})";
  }
  re += format.slice(last).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${re}$`).exec(name);
  if (!match) return null;
  let y = NaN, mo = NaN, d = NaN, h = 0, mi = 0, s = 0;
  fields.forEach((tok, i) => {
    const v = Number(match[i + 1]);
    if (tok === "YYYY") y = v;
    else if (tok === "YY") y = 2000 + v;
    else if (tok === "MM" || tok === "M") mo = v;
    else if (tok === "DD" || tok === "D") d = v;
    else if (tok === "HH") h = v;
    else if (tok === "mm") mi = v;
    else if (tok === "ss") s = v;
  });
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s) / MS_PER_DAY + EPOCH_OFFSET;
}

function coerceScalar(value: FrontmatterScalar, kind: ScalarKind): FrontmatterScalar {
  if (value === null) return null;
  switch (kind) {
    case "number": {
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case "logical": {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      const t = String(value).trim().toLowerCase();
      return t === "true" ? true : t === "false" ? false : null;
    }
    case "date": {
      if (typeof value === "number") return value;
      const r = parseDate(String(value));
      return typeof r === "number" && Number.isFinite(r) ? r : null;
    }
    case "string":
    default:
      return typeof value === "string" ? value : String(value);
  }
}

function cellKind(value: FrontmatterScalar, guessed: ScalarKind): ScalarKind {
  if (guessed === "date") return "date";
  if (typeof value === "string" && ISO_DATETIME.test(value)) return "date";
  return guessed;
}

function widenScalar(kinds: ScalarKind[]): ScalarKind {
  const set = new Set(kinds);
  if (set.size === 1) return [...set][0];
  return "string";
}

type ParsedNote = {
  path: string;
  fields: Map<string, { value: FrontmatterValueLoose; guessed: string }>;
  body: string;
};
type FrontmatterValueLoose = FrontmatterScalar | FrontmatterScalar[] | FrontmatterScalar[][] | FrontmatterRow[];

const BUILTINS = ["path", "name", "folder", "ext", "size", "created", "modified", "tags", "links", "embeds", "date"] as const;

function baseName(path: string): string {
  const b = path.split("/").pop() ?? path;
  return b.replace(/\.[^.]+$/, "");
}
function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
function extOf(path: string): string {
  const b = path.split("/").pop() ?? path;
  const i = b.lastIndexOf(".");
  return i < 0 ? "" : b.slice(i);
}

export function notesToCube(notes: readonly VaultNote[], sources: VaultTypeSources, opts: VaultCubeOptions = {}): CubeValue {
  const parsed: ParsedNote[] = notes.map((n) => {
    const pf = parseNoteFrontmatter(n.text);
    const fields = new Map<string, { value: FrontmatterValueLoose; guessed: string }>();
    for (const f of pf.fields) fields.set(f.key, { value: f.value, guessed: f.guessed });
    return { path: n.path, fields, body: pf.body };
  });

  const noteByPath = new Map(notes.map((n) => [n.path, n]));
  const builtinCells: Record<string, CubeCell[]> = Object.fromEntries(BUILTINS.map((b) => [b, []]));
  if (opts.includeBody) builtinCells.body = [];
  for (const p of parsed) {
    const note = noteByPath.get(p.path)!;
    const fmTags = p.fields.get("tags");
    const fmTagList = fmTags
      ? (Array.isArray(fmTags.value) ? (fmTags.value as FrontmatterScalar[]).map(String) : [String(fmTags.value)])
      : [];
    const tags = uniqueInOrder([...fmTagList, ...extractInlineTags(p.body)]);
    builtinCells.path.push(p.path);
    builtinCells.name.push(baseName(p.path));
    builtinCells.folder.push(folderOf(p.path));
    builtinCells.ext.push(extOf(p.path));
    builtinCells.size.push(typeof note.size === "number" ? note.size : utf8Bytes(note.text));
    builtinCells.created.push(msToSerial(note.birthtimeMs));
    builtinCells.modified.push(msToSerial(note.mtimeMs));
    builtinCells.tags.push(tags);
    builtinCells.links.push(extractLinks(note.text));
    builtinCells.embeds.push(extractEmbeds(note.text));
    builtinCells.date.push(opts.nameFormat ? dateFromName(baseName(p.path), opts.nameFormat) : null);
    if (opts.includeBody) builtinCells.body.push(p.body);
  }

  const builtinNames = new Set<string>([...BUILTINS, "note-body"]);
  const fmKeys: string[] = [];
  const seen = new Set<string>();
  for (const p of parsed) {
    for (const key of p.fields.keys()) {
      if (builtinNames.has(key) || seen.has(key)) continue;
      seen.add(key);
      fmKeys.push(key);
    }
  }

  const columns: { name: string; cells: CubeCell[]; type?: FrameColType }[] = [];
  for (const b of BUILTINS) columns.push({ name: b, cells: builtinCells[b], type: colType(b) });
  if (opts.includeBody) columns.push({ name: "note-body", cells: builtinCells.body, type: "string" });

  for (const key of fmKeys) {
    const hint = resolveHint(key, parsed, sources);
    columns.push(buildColumn(key, hint, parsed, sources.columns?.[key]));
  }

  return cubeFromColumns(columns);
}

function colType(b: string): FrameColType | undefined {
  if (b === "size") return "number";
  if (b === "created" || b === "modified" || b === "date") return "date";
  return "string";
}

function resolveHint(key: string, parsed: ParsedNote[], sources: VaultTypeSources): TypeHint | null {
  for (const p of parsed) {
    const h = sources.mdbaseFor(p.path)[key];
    if (h) return h;
  }
  return sources.obsidian[key] ?? null;
}

function buildColumn(key: string, hint: TypeHint | null, parsed: ParsedNote[], picks?: ColumnPicks): { name: string; cells: CubeCell[]; type?: FrameColType } {
  const shape: TypeHint = hint ?? guessShape(key, parsed);
  const cells: CubeCell[] = parsed.map((p) => { const f = p.fields.get(key); return cellFor(f?.value, shape, picks, f?.guessed); });
  const kind = shape.kind === "list" || shape.kind === "matrix" ? shape.elem : shape.kind;
  const type: FrameColType | undefined =
    kind === "frame" ? undefined
    : kind === "logical" ? "logical"
    : kind === "date" ? "date"
    : kind === "number" ? "number"
    : "string";
  return { name: key, cells, type };
}

function guessShape(key: string, parsed: ParsedNote[]): TypeHint {
  let anyFrame = false;
  let anyList = false;
  let anyMatrix = false;
  const listElemKinds: ScalarKind[] = [];
  const scalarKinds: ScalarKind[] = [];
  for (const p of parsed) {
    const field = p.fields.get(key);
    if (!field || field.value === null) continue;
    const v = field.value;
    if (Array.isArray(v)) {
      const isMatrix = v.length > 0 && Array.isArray(v[0]);
      if (!isMatrix && v.length > 0 && typeof v[0] === "object" && v[0] !== null) { anyFrame = true; continue; }
      if (isMatrix) anyMatrix = true; else anyList = true;
      const isDate = field.guessed === "datelist" || field.guessed === "datetable";
      for (const item of (v as unknown[]).flat() as FrontmatterScalar[]) {
        if (item === null) continue;
        listElemKinds.push(cellKind(item, isDate ? "date" : scalarKindOfValue(item)));
      }
    } else {
      scalarKinds.push(cellKind(v, field.guessed === "date" ? "date" : scalarKindOfValue(v)));
    }
  }
  if (anyFrame) return { kind: "frame" };
  if (anyMatrix) return { kind: "matrix", elem: listElemKinds.length ? widenScalar(listElemKinds) : "string" };
  if (anyList) return { kind: "list", elem: listElemKinds.length ? widenScalar(listElemKinds) : "string" };
  return { kind: scalarKinds.length ? widenScalar(scalarKinds) : "string" };
}

function scalarKindOfValue(v: FrontmatterScalar): ScalarKind {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "logical";
  return "string";
}

/** A date the reader turned into a serial, read under a text type, is the ISO text written. */
function datesToText(value: FrontmatterValueLoose | undefined): FrontmatterValueLoose | undefined {
  const one = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(one) : typeof v === "number" ? isoDateText(v) : v;
  return one(value) as FrontmatterValueLoose | undefined;
}

function cellFor(value: FrontmatterValueLoose | undefined, shape: TypeHint, picks: ColumnPicks = {}, guessed?: string): CubeCell {
  const textShape = "elem" in shape ? shape.elem === "string" : shape.kind === "string";
  if (textShape && guessed !== undefined && guessed.startsWith("date")) value = datesToText(value);
  if (value === undefined || value === null) return null;
  if (shape.kind === "frame") {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
      return recordsToCube(value as FrontmatterRow[], picks);
    }
    return null;
  }
  if (shape.kind === "matrix") {
    const rows = Array.isArray(value) ? (Array.isArray(value[0]) ? (value as FrontmatterScalar[][]) : [value as FrontmatterScalar[]]) : [[value as FrontmatterScalar]];
    return rows.map((row) => row.map((item) => coerceScalar(item, shape.elem))) as CubeCell[];
  }
  if (shape.kind === "list") {
    const arr = (Array.isArray(value) ? (value as unknown[]).flat() : [value]) as FrontmatterScalar[];
    return arr.map((item) => coerceScalar(item, shape.elem)) as CubeCell[];
  }
  const scalar = (Array.isArray(value) ? ((value as unknown[]).flat()[0] ?? null) : value) as FrontmatterScalar;
  return coerceScalar(scalar, shape.kind);
}
