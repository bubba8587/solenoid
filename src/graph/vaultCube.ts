// The Vault Folder reader's pure core (bundle 24 item A): a folder of notes → ONE cube,
// one row per note. Built-in columns (the Bases `file.*` set, prefix dropped) + the union
// of frontmatter keys; a scalar cell is typed, a list is a list cell, rows-of-objects is a
// nested frame. Typing per key = first source that answers: mdbase → `.obsidian/types.json`
// → the guesser widened across rows. Graph/DOM-free; the node supplies the files + sources.
import {
  cubeFromColumns, recordsToCube,
  type CubeValue, type CubeCell, type FrameColType,
} from "./frame";
import { parseNoteFrontmatter, type FrontmatterScalar, type FrontmatterRow } from "./noteFrontmatter";
import { parseDate } from "./nodes/dateSerial";
import { type TypeHint, type TypeMap, type ScalarKind } from "./vaultTypes";

export interface VaultNote {
  /** Vault-relative path, POSIX-style ("Projects/Kitchen remodel.md"). */
  path: string;
  text: string;
  /** Disk times in epoch ms (desktop `statVaultFile`); absent → null columns. */
  mtimeMs?: number | null;
  birthtimeMs?: number | null;
  /** Byte size on disk; absent → the text's UTF-8 length. */
  size?: number | null;
}

export interface VaultTypeSources {
  /** Per-key mdbase hints for the note at `path` (its collection's schema), or {}. */
  mdbaseFor: (path: string) => TypeMap;
  /** The vault-wide `.obsidian/types.json` hints. */
  obsidian: TypeMap;
}

export interface VaultCubeOptions {
  /** Moment-token file-name format; parses `name` into the `date` column (R3). */
  nameFormat?: string;
  /** Add a `body` column carrying each note's markdown body (off by default). */
  includeBody?: boolean;
}

const MS_PER_DAY = 86400000;
const EPOCH_OFFSET = 25569;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

const msToSerial = (ms: number | null | undefined): number | null =>
  typeof ms === "number" && Number.isFinite(ms) ? ms / MS_PER_DAY + EPOCH_OFFSET : null;

function utf8Bytes(s: string): number {
  // Deterministic byte count without Buffer (browser + node).
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length;
}

// ─── Built-in extractions (one regex pass over text already in memory) ───────────
const WIKILINK = /\[\[([^\]]+)\]\]/g;
const EMBED = /!\[\[([^\]]+)\]\]/g;
const INLINE_TAG = /(?:^|\s)#([A-Za-z0-9_][\w/-]*)/g;

/** Target of a `[[link]]` / `![[embed]]` inner text: drop a `|alias` and a `#heading`. */
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
function extractInlineTags(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(INLINE_TAG)) out.push(m[1]);
  return out;
}

// ─── R3: the date out of the file name ──────────────────────────────────────────
const NAME_TOKEN = /YYYY|YY|MM|M|DD|D|HH|mm|ss/g;

/** Parse `name` by a moment-token `format` into a date serial (null on no match / no day).
 *  Supports the daily-note tokens; unknown tokens become literals. */
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
      : "(\\d{1,2})"; // M / D
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

// ─── Scalar coercion to a resolved column kind ──────────────────────────────────
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
      if (typeof value === "number") return value; // already a serial
      const r = parseDate(String(value));
      return typeof r === "number" && Number.isFinite(r) ? r : null;
    }
    case "string":
    default:
      return typeof value === "string" ? value : String(value);
  }
}

/** A note's per-cell kind for one key, upgrading an ISO-datetime string to date (the
 *  guesser's ISO-datetime fix, kept local to the reader). */
function cellKind(value: FrontmatterScalar, guessed: ScalarKind): ScalarKind {
  if (guessed === "date") return "date";
  if (typeof value === "string" && ISO_DATETIME.test(value)) return "date";
  return guessed;
}

/** Widen a set of per-row scalar kinds: all-agree → that; anything mixed / empty → string. */
function widenScalar(kinds: ScalarKind[]): ScalarKind {
  const set = new Set(kinds);
  if (set.size === 1) return [...set][0];
  return "string";
}

// ─── Column assembly ────────────────────────────────────────────────────────────
type ParsedNote = {
  path: string;
  fields: Map<string, { value: FrontmatterValueLoose; guessed: string }>;
  body: string;
};
type FrontmatterValueLoose = FrontmatterScalar | FrontmatterScalar[] | FrontmatterRow[];

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

/** Assemble the cube. One row per note, built-ins first, then frontmatter columns in
 *  first-seen order (a `tags` key folds into the built-in; other built-in-name clashes
 *  are dropped, the built-in winning). */
export function notesToCube(notes: readonly VaultNote[], sources: VaultTypeSources, opts: VaultCubeOptions = {}): CubeValue {
  const parsed: ParsedNote[] = notes.map((n) => {
    const pf = parseNoteFrontmatter(n.text);
    const fields = new Map<string, { value: FrontmatterValueLoose; guessed: string }>();
    for (const f of pf.fields) fields.set(f.key, { value: f.value, guessed: f.guessed });
    return { path: n.path, fields, body: pf.body };
  });

  // Built-in cells, per note.
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

  // Frontmatter column order: first-seen across notes, minus built-in-name clashes.
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
  // The note body rides in a `note-body` column — the reserved property the writer round-trips.
  if (opts.includeBody) columns.push({ name: "note-body", cells: builtinCells.body, type: "string" });

  for (const key of fmKeys) {
    // Resolve the column's parse shape: a hint (mdbase → obsidian), else the guesser.
    const hint = resolveHint(key, parsed, sources);
    columns.push(buildColumn(key, hint, parsed));
  }

  return cubeFromColumns(columns);
}

/** The display-type hint for a built-in column (cube columns carry it only as a hint). */
function colType(b: string): FrameColType | undefined {
  if (b === "size") return "number";
  if (b === "created" || b === "modified" || b === "date") return "date";
  return "string";
}

/** First hint that answers for `key`: mdbase (first note with one) → obsidian → null. */
function resolveHint(key: string, parsed: ParsedNote[], sources: VaultTypeSources): TypeHint | null {
  for (const p of parsed) {
    const h = sources.mdbaseFor(p.path)[key];
    if (h) return h;
  }
  return sources.obsidian[key] ?? null;
}

function buildColumn(key: string, hint: TypeHint | null, parsed: ParsedNote[]): { name: string; cells: CubeCell[]; type?: FrameColType } {
  // A hint decides the shape outright; otherwise the guesser looks across the rows.
  const shape: TypeHint = hint ?? guessShape(key, parsed);
  const cells: CubeCell[] = parsed.map((p) => cellFor(p.fields.get(key)?.value, shape));
  const type: FrameColType | undefined =
    shape.kind === "frame" ? undefined
    : shape.kind === "list" ? undefined
    : shape.kind === "logical" ? "logical"
    : shape.kind === "date" ? "date"
    : shape.kind === "number" ? "number"
    : "string";
  return { name: key, cells, type };
}

/** The guesser: frame if any row is rows-of-objects; list if any row is an array; else a
 *  widened scalar (all-agree, upgrading ISO datetimes to date; mixed → string). */
function guessShape(key: string, parsed: ParsedNote[]): TypeHint {
  let anyFrame = false;
  let anyList = false;
  const listElemKinds: ScalarKind[] = [];
  const scalarKinds: ScalarKind[] = [];
  for (const p of parsed) {
    const field = p.fields.get(key);
    if (!field || field.value === null) continue;
    const v = field.value;
    if (Array.isArray(v)) {
      if (v.length > 0 && typeof v[0] === "object" && v[0] !== null) { anyFrame = true; continue; }
      anyList = true;
      for (const item of v as FrontmatterScalar[]) {
        if (item === null) continue;
        listElemKinds.push(cellKind(item, scalarKindOfValue(item)));
      }
    } else {
      scalarKinds.push(cellKind(v, field.guessed === "date" ? "date" : scalarKindOfValue(v)));
    }
  }
  if (anyFrame) return { kind: "frame" };
  if (anyList) return { kind: "list", elem: listElemKinds.length ? widenScalar(listElemKinds) : "string" };
  return { kind: scalarKinds.length ? widenScalar(scalarKinds) : "string" };
}

function scalarKindOfValue(v: FrontmatterScalar): ScalarKind {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "logical";
  return "string";
}

/** One cell for a note's raw value, shaped to the column. Missing → null. */
function cellFor(value: FrontmatterValueLoose | undefined, shape: TypeHint): CubeCell {
  if (value === undefined || value === null) return null;
  if (shape.kind === "frame") {
    // A rows-of-objects key is a nested CUBE (no in-cell string lists — the cube holds a
    // record whose field may itself be a list); frame.ts's recordsToCube is the shared shape.
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
      return recordsToCube(value as FrontmatterRow[]);
    }
    return null;
  }
  if (shape.kind === "list") {
    const arr = Array.isArray(value) ? (value as FrontmatterScalar[]) : [value as FrontmatterScalar];
    return arr.map((item) => coerceScalar(item, shape.elem)) as CubeCell[];
  }
  // Scalar: a stray array collapses to its first cell.
  const scalar = Array.isArray(value) ? ((value as FrontmatterScalar[])[0] ?? null) : (value as FrontmatterScalar);
  return coerceScalar(scalar, shape.kind);
}
