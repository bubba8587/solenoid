// [[C101]] onePatchPath
import { yamlKey, yamlScalar } from "./obsidianMarkdown";
import { isFrameValue, isCubeValue, type CubeCell, type CubeValue, type FrameColType, type FrameValue } from "./frame";
import { formatDateSerial } from "./nodes/dateSerial";
import { parseNoteFrontmatter } from "./noteFrontmatter";
import { extractInlineTags } from "./vaultCube";

export type YamlScalarV = string | number | boolean | null;
export type YamlRowV = YamlScalarV | YamlScalarV[];
export type YamlValue = YamlScalarV | YamlScalarV[] | Record<string, YamlRowV>[];

export interface PatchResult { text: string; }

const FENCE = "---";

const isWholeDay = (serial: number) => Math.abs(serial - Math.round(serial)) < 1e-6;
// yamlScalar would quote a leading-digit string, so ISO dates bypass it to stay YAML dates.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
function renderScalar(v: YamlScalarV): string {
  return typeof v === "string" && (ISO_DATE.test(v) || ISO_DT.test(v)) ? v : yamlScalar(v);
}

export function cellToYaml(cell: CubeCell, colType: FrameColType | undefined, noteNames: ReadonlySet<string>): YamlValue {
  if (cell === null || cell === undefined) return null;
  if (isFrameValue(cell)) return frameRows(cell.columns.map((c) => ({ name: c.name, cells: c.values as CubeCell[], type: c.type })), noteNames);
  if (isCubeValue(cell)) return frameRows(cell.columns.map((c) => ({ name: c.name, cells: c.cells, type: c.type })), noteNames);
  if (Array.isArray(cell)) return cell.map((c) => scalarToYaml(c as CubeCell, colType, noteNames)) as YamlScalarV[];
  return scalarToYaml(cell, colType, noteNames);
}

function scalarToYaml(cell: CubeCell, colType: FrameColType | undefined, noteNames: ReadonlySet<string>): YamlScalarV {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "boolean") return cell;
  if (typeof cell === "number") {
    if (colType === "date" && Number.isFinite(cell)) {
      return formatDateSerial(cell, isWholeDay(cell) ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
    }
    return cell;
  }
  const s = String(cell);
  return noteNames.has(s) ? `[[${s}]]` : s;
}

interface Col { name: string; cells: CubeCell[]; type?: FrameColType; }
function frameRows(cols: Col[], noteNames: ReadonlySet<string>): Record<string, YamlRowV>[] {
  const n = cols.reduce((m, c) => Math.max(m, c.cells.length), 0);
  const rows: Record<string, YamlRowV>[] = [];
  for (let i = 0; i < n; i++) {
    const row: Record<string, YamlRowV> = {};
    for (const c of cols) {
      const cell = c.cells[i] ?? null;
      row[c.name] = Array.isArray(cell) ? cell.map((x) => scalarToYaml(x as CubeCell, c.type, noteNames)) : scalarToYaml(cell, c.type, noteNames);
    }
    rows.push(row);
  }
  return rows;
}

function isRows(v: YamlValue): v is Record<string, YamlRowV>[] {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null;
}

/** A blank value is written as Obsidian writes it, `key:` with nothing after. */
const line = (head: string, v: YamlScalarV) => `${head} ${renderScalar(v)}`.trimEnd();

function renderRow(row: Record<string, YamlRowV>): string[] {
  const out: string[] = [];
  for (const [k, val] of Object.entries(row)) {
    const lead = out.length === 0 ? "  - " : "    ";
    const key = yamlKey(k);
    if (Array.isArray(val)) {
      if (val.length === 0) { out.push(`${lead}${key}: []`); continue; }
      out.push(`${lead}${key}:`, ...val.map((x) => line("      -", x)));
    } else {
      out.push(line(`${lead}${key}:`, val));
    }
  }
  return out;
}

export function renderKey(rawKey: string, v: YamlValue, spelledAs?: string): string[] {
  const key = spelledAs ?? yamlKey(rawKey);
  if (isRows(v)) return [`${key}:`, ...v.flatMap(renderRow)];
  if (Array.isArray(v)) {
    if (v.length === 0) return [`${key}: []`];
    return [`${key}:`, ...(v as YamlScalarV[]).map((x) => line("  -", x))];
  }
  return [line(`${key}:`, v)];
}

interface KeySpan { start: number; end: number; scalar: boolean; rest: string; head: string; }

const QUOTED_KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:(?:\s+(.*))?$/;
const PLAIN_KEY = /^([^\s#'"-].*?|-\S.*?)\s*:(?:\s+(.*))?$/;

function topKey(line: string): { key: string; rest: string; head: string } | null {
  const q = QUOTED_KEY.exec(line);
  if (q) {
    const raw = q[1];
    const key = raw[0] === "'" ? raw.slice(1, -1).replace(/''/g, "'") : raw.slice(1, -1).replace(/\\(.)/g, "$1");
    return { key, rest: q[2] ?? "", head: raw };
  }
  const m = PLAIN_KEY.exec(line);
  return m ? { key: m[1].trim(), rest: m[2] ?? "", head: m[1].trim() } : null;
}

const isIndented = (l: string) => /^\s/.test(l);
const isSeqItem = (l: string) => /^-(\s|$)/.test(l);

/** Every unindented line bounds the key above it, except a sequence item written at column 0; a comment belongs
 *  to the key above only when an indented line follows it. So a patch never swallows a line it does not own. */
function scanKeys(interior: string[]): Map<string, KeySpan> {
  const spans = new Map<string, KeySpan>();
  const bounds: { key: string | null; line: number; rest: string; head: string }[] = [];
  for (let i = 0; i < interior.length; i++) {
    const l = interior[i];
    if (l.trim() === "" || isIndented(l) || isSeqItem(l)) continue;
    if (l.startsWith("#")) {
      let j = i + 1;
      while (j < interior.length && (interior[j].trim() === "" || interior[j].startsWith("#"))) j++;
      if (j < interior.length && (isIndented(interior[j]) || isSeqItem(interior[j]))) continue;
    }
    const k = l.startsWith("#") ? null : topKey(l);
    bounds.push({ key: k?.key ?? null, line: i, rest: k?.rest ?? "", head: k?.head ?? "" });
  }
  for (let s = 0; s < bounds.length; s++) {
    const { key, line, rest, head } = bounds[s];
    if (key === null) continue;
    let end = (s + 1 < bounds.length ? bounds[s + 1].line : interior.length) - 1;
    while (end > line && interior[end].trim() === "") end--;
    const scalar = rest.trim() !== "" || end === line;
    if (!spans.has(key)) spans.set(key, { start: line, end, scalar, rest, head });
  }
  return spans;
}

/** The lines with any CR stripped, and the note's own line ending to join them back with. */
function splitLines(text: string): { lines: string[]; nl: string } {
  return { lines: text.split("\n").map((l) => l.replace(/\r$/, "")), nl: text.includes("\r\n") ? "\r\n" : "\n" };
}

function fenceClose(lines: string[]): number {
  if (lines[0]?.trim() !== FENCE) return -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === FENCE) return i;
  return -1;
}

export function patchFrontmatter(text: string, patch: Record<string, YamlValue>): PatchResult {
  const keys = Object.keys(patch);
  if (keys.length === 0) return { text };

  const { lines, nl } = splitLines(text);
  const rendered = () => keys.flatMap((k) => renderKey(k, patch[k]));
  if (lines[0]?.trim() !== FENCE) return { text: [FENCE, ...rendered(), FENCE, ""].join(nl) + text };
  const close = fenceClose(lines);
  if (close === -1) return { text: [FENCE, ...rendered(), FENCE, "", ...lines].join(nl) };

  const interior = lines.slice(1, close);
  const spans = scanKeys(interior);

  const replacements = new Map<number, { end: number; lines: string[] }>();
  const appends: string[] = [];
  for (const key of keys) {
    const span = spans.get(key);
    if (span) {
      replacements.set(span.start, { end: span.end, lines: renderKey(key, patch[key], span.head) });
    } else {
      appends.push(...renderKey(key, patch[key]));
    }
  }

  const out: string[] = [];
  for (let i = 0; i < interior.length; i++) {
    const r = replacements.get(i);
    if (r) { out.push(...r.lines); i = r.end; continue; }
    out.push(interior[i]);
  }
  out.push(...appends);

  const rebuilt = [lines[0], ...out, ...lines.slice(close)];
  return { text: rebuilt.join(nl) };
}


export const BUILTIN_READONLY = new Set([
  "path", "name", "folder", "ext", "size", "created", "modified", "links", "embeds", "date",
]);

export const NOTE_BODY = "note-body";

function splitFrontmatter(text: string): { fm: string; body: string } {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== FENCE) return { fm: "", body: text };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      return { fm: lines.slice(0, i + 1).join("\n"), body: lines.slice(i + 1).join("\n").replace(/^(\r?\n)+/, "") };
    }
  }
  return { fm: "", body: text };
}

export function setBody(text: string, newBody: string): string {
  const { fm } = splitFrontmatter(text);
  if (fm === "") return newBody;
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  return `${fm.replace(/\r$/, "")}${nl}${nl}${newBody.replace(/(\r?\n)+$/, "")}${nl}`;
}

function bodySnippet(body: string): string {
  const t = body.trim();
  if (t === "") return "(empty)";
  const first = t.split("\n")[0];
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

export function resolveBody(text: string, newBody: string): { action: "unchanged" | "update"; before: string } {
  const { body } = splitFrontmatter(text);
  return { action: body.trim() === newBody.trim() ? "unchanged" : "update", before: bodySnippet(body) };
}

export type PlanAction = "pending" | "add" | "update" | "unchanged" | "unreadable" | "refused";

export interface PlanRow {
  path: string;
  key: string;
  value: YamlValue;
  after: string;
  before: string;
  action: PlanAction;
  reason?: string;
}

export function writableKeys(cube: CubeValue, keysCsv: string): string[] {
  const present = new Set(cube.columns.map((c) => c.name));
  const listed = keysCsv.split(",").map((s) => s.trim()).filter(Boolean);
  if (listed.length > 0) return listed.filter((k) => present.has(k) && k !== "path" && k !== NOTE_BODY);
  return cube.columns.map((c) => c.name).filter((k) => k !== "path" && k !== NOTE_BODY && !BUILTIN_READONLY.has(k));
}

const colType = (cube: CubeValue, name: string): FrameColType | undefined =>
  cube.columns.find((c) => c.name === name)?.type;

export function displayValue(v: YamlValue): string {
  if (v === null) return "";
  if (Array.isArray(v)) {
    if (isRows(v)) return `${v.length} row${v.length === 1 ? "" : "s"}`;
    return `[${(v as YamlScalarV[]).map((x) => renderScalar(x)).join(", ")}]`;
  }
  return renderScalar(v);
}

export function planPropertyWrites(cube: CubeValue, keysCsv: string, noteNames: ReadonlySet<string>): PlanRow[] {
  const pathCol = cube.columns.find((c) => c.name === "path");
  if (!pathCol) return [];
  const keys = writableKeys(cube, keysCsv);
  const cols = keys.map((k) => ({ key: k, cells: cube.columns.find((c) => c.name === k)!.cells, type: colType(cube, k) }));
  const rows: PlanRow[] = [];
  for (let i = 0; i < pathCol.cells.length; i++) {
    const p = pathCol.cells[i];
    if (typeof p !== "string" || p.trim() === "") continue;
    for (const c of cols) {
      const value = cellToYaml(c.cells[i] ?? null, c.type, noteNames);
      rows.push({ path: p, key: c.key, value, after: displayValue(value), before: "", action: "pending" });
    }
  }
  const listed = keysCsv.split(",").map((s) => s.trim()).filter(Boolean);
  const bodyCol = cube.columns.find((c) => c.name === NOTE_BODY);
  if (bodyCol && (listed.length === 0 || listed.includes(NOTE_BODY))) {
    for (let i = 0; i < pathCol.cells.length; i++) {
      const p = pathCol.cells[i];
      if (typeof p !== "string" || p.trim() === "") continue;
      const cell = bodyCol.cells[i];
      if (typeof cell !== "string") continue;
      rows.push({ path: p, key: NOTE_BODY, value: cell, after: bodySnippet(cell), before: "", action: "pending" });
    }
  }
  return rows;
}

export function resolveKey(text: string, key: string, value: YamlValue): { action: "add" | "unchanged" | "update"; before: string } {
  const { lines } = splitLines(text);
  const close = fenceClose(lines);
  if (close === -1) return { action: "add", before: "" };
  const interior = lines.slice(1, close);
  const span = scanKeys(interior).get(key);
  if (!span) return { action: "add", before: "" };
  const existing = interior.slice(span.start, span.end + 1);
  const before = span.scalar
    ? span.rest.trim()
    : existing.slice(1).map((l) => l.trim()).filter(Boolean).join(", ");
  const rendered = renderKey(key, value, span.head);
  const same = existing.length === rendered.length && existing.every((l, i) => l.trimEnd() === rendered[i]);
  return { action: same ? "unchanged" : "update", before };
}

/** Vault Folder's `tags` column is Bases' `file.tags`, which folds in the body's inline tags. Writing it back leaves
 *  out a tag only the body holds, so a round trip never copies inline tags into the frontmatter. */
export function frontmatterTags(text: string, value: YamlValue): YamlValue {
  if (!Array.isArray(value)) return value;
  const parsed = parseNoteFrontmatter(text);
  const own = parsed.fields.find((f) => f.key === "tags")?.value;
  const fmTags = new Set((Array.isArray(own) ? own : own == null ? [] : [own]).map(String));
  const inline = new Set(extractInlineTags(parsed.body));
  return (value as YamlScalarV[]).filter((t) => typeof t !== "string" || fmTags.has(t) || !inline.has(t));
}

export function propertyPlanFrame(rows: readonly PlanRow[]): FrameValue {
  return {
    __frame: true,
    columns: [
      { name: "path",   type: "string", values: rows.map((r) => r.path) },
      { name: "key",    type: "string", values: rows.map((r) => r.key) },
      { name: "before", type: "string", values: rows.map((r) => r.before) },
      { name: "after",  type: "string", values: rows.map((r) => r.after) },
      { name: "action", type: "string", values: rows.map((r) => (r.reason ? `${r.action} — ${r.reason}` : r.action)) },
    ],
  };
}
