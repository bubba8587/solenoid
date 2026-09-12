// Write Properties' pure core (bundle 24 item B): patch a note's YAML frontmatter
// LINE-LEVEL over the raw text — never parse-and-reserialize, so every untouched byte
// stays identical (the write-safety story: onePatchPath, the ONE writer of a note's YAML).
// Graph/DOM-free.
import { yamlScalar } from "./obsidianMarkdown";
import { isFrameValue, isCubeValue, type CubeCell, type CubeValue, type FrameColType, type FrameValue } from "./frame";
import { formatDateSerial } from "./nodes/dateSerial";

/** A value ready to render as YAML: a scalar, a scalar list, or rows of scalar objects. */
export type YamlScalarV = string | number | boolean | null;
export type YamlValue = YamlScalarV | YamlScalarV[] | Record<string, YamlScalarV>[];

export interface Refusal { key: string; reason: string; }
export interface PatchResult { text: string; refused: Refusal[]; }

const FENCE = "---";
// A top-level key line (indent 0): `key:` or `key: value`.
const TOP_KEY = /^([A-Za-z0-9_][\w .-]*?):\s*(.*)$/;

// ─── Cube cell → a YAML-ready value ─────────────────────────────────────────────
const isWholeDay = (serial: number) => Math.abs(serial - Math.round(serial)) < 1e-6;
// ISO date / datetime strings render UNQUOTED (yamlScalar would quote a leading-digit
// string), so a date round-trips as a YAML date, not a quoted string.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
function renderScalar(v: YamlScalarV): string {
  return typeof v === "string" && (ISO_DATE.test(v) || ISO_DT.test(v)) ? v : yamlScalar(v);
}

/** Normalize one cube cell to a YamlValue, honoring the column's date type and turning a
 *  string that names an existing note into a `[[Name]]` link. Nested frame/cube → rows. */
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
function frameRows(cols: Col[], noteNames: ReadonlySet<string>): Record<string, YamlScalarV>[] {
  const n = cols.reduce((m, c) => Math.max(m, c.cells.length), 0);
  const rows: Record<string, YamlScalarV>[] = [];
  for (let i = 0; i < n; i++) {
    const row: Record<string, YamlScalarV> = {};
    for (const c of cols) row[c.name] = scalarToYaml(c.cells[i] ?? null, c.type, noteNames);
    rows.push(row);
  }
  return rows;
}

// ─── Rendering a key's YAML line(s) ─────────────────────────────────────────────
function isRows(v: YamlValue): v is Record<string, YamlScalarV>[] {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null;
}

/** The line(s) a key + value render to (no trailing newline; caller joins). */
export function renderKey(key: string, v: YamlValue): string[] {
  if (isRows(v)) {
    return [`${key}:`, ...v.map((row) => `  - {${Object.entries(row).map(([k, val]) => `${k}: ${renderScalar(val)}`).join(", ")}}`)];
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return [`${key}: []`];
    return [`${key}:`, ...(v as YamlScalarV[]).map((x) => `  - ${renderScalar(x)}`)];
  }
  return [`${key}: ${renderScalar(v)}`];
}

// ─── The block scan: each top-level key's line range + shape ─────────────────────
type Shape = "scalar" | "list" | "block";
interface KeySpan { start: number; end: number; shape: Shape; } // indices into `interior`

function scanKeys(interior: string[]): Map<string, KeySpan> {
  const spans = new Map<string, KeySpan>();
  const starts: { key: string; line: number; rest: string }[] = [];
  for (let i = 0; i < interior.length; i++) {
    if (/^\s/.test(interior[i])) continue; // an indented / block line, not a top key
    const m = TOP_KEY.exec(interior[i]);
    if (m) starts.push({ key: m[1].trim(), line: i, rest: m[2] });
  }
  for (let s = 0; s < starts.length; s++) {
    const { key, line, rest } = starts[s];
    const end = (s + 1 < starts.length ? starts[s + 1].line : interior.length) - 1;
    let shape: Shape = "scalar";
    if (rest.trim() === "") {
      const body = interior.slice(line + 1, end + 1).filter((l) => l.trim() !== "");
      if (body.length > 0) shape = body.every((l) => /^\s*-\s/.test(l)) ? "list" : "block";
    }
    if (!spans.has(key)) spans.set(key, { start: line, end, shape });
  }
  return spans;
}

/** Patch `text`'s frontmatter with `patch` (key → YamlValue), LINE-LEVEL. A key whose
 *  current value is an unparsed nested block is REFUSED (never corrupted); a missing key
 *  is appended before the closing fence; a note with no block gets one. */
export function patchFrontmatter(text: string, patch: Record<string, YamlValue>): PatchResult {
  const keys = Object.keys(patch);
  if (keys.length === 0) return { text, refused: [] };

  const lines = text.split("\n");
  const refused: Refusal[] = [];

  // No top-of-file block → create one before the body.
  if (lines[0]?.trim() !== FENCE) {
    const rendered = keys.flatMap((k) => renderKey(k, patch[k]));
    const block = [FENCE, ...rendered, FENCE, ""].join("\n");
    return { text: block + text, refused };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) { close = i; break; }
  }
  if (close === -1) {
    // Unterminated fence — treat as no block (don't touch the body); render a fresh one.
    const rendered = keys.flatMap((k) => renderKey(k, patch[k]));
    return { text: [FENCE, ...rendered, FENCE, "", ...lines].join("\n"), refused };
  }

  const interior = lines.slice(1, close);
  const spans = scanKeys(interior);

  // Which interior lines get replaced, and by what; plus keys to append.
  const replacements = new Map<number, { end: number; lines: string[] }>();
  const appends: string[] = [];
  for (const key of keys) {
    const span = spans.get(key);
    if (span) {
      if (span.shape === "block") { refused.push({ key, reason: "the note's value is a nested block the line patcher won't rewrite" }); continue; }
      replacements.set(span.start, { end: span.end, lines: renderKey(key, patch[key]) });
    } else {
      appends.push(...renderKey(key, patch[key]));
    }
  }

  // Rebuild the interior, keeping every untouched line byte-identical.
  const out: string[] = [];
  for (let i = 0; i < interior.length; i++) {
    const r = replacements.get(i);
    if (r) { out.push(...r.lines); i = r.end; continue; }
    out.push(interior[i]);
  }
  out.push(...appends);

  const rebuilt = [lines[0], ...out, ...lines.slice(close)];
  return { text: rebuilt.join("\n"), refused };
}

// ─── The write PLAN (path · key · before · after · action) ───────────────────────
// Built pure from the cube in data(); Preview fills `before` + resolves the action.

/** File.* columns Write Properties never writes back (they describe the file, not the note). */
export const BUILTIN_READONLY = new Set([
  "path", "name", "folder", "ext", "size", "created", "modified", "links", "embeds", "date",
]);

/** The reserved cube property whose value is the note's BODY (not a frontmatter key) —
 *  the round-trip partner of Vault Folder's include-body `note-body` column. */
export const NOTE_BODY = "note-body";

/** Split a note into its frontmatter block (fences included, or "") and the body below. */
function splitFrontmatter(text: string): { fm: string; body: string } {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== FENCE) return { fm: "", body: text };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      return { fm: lines.slice(0, i + 1).join("\n"), body: lines.slice(i + 1).join("\n").replace(/^(\r?\n)+/, "") };
    }
  }
  return { fm: "", body: text }; // unterminated fence — treat as no block
}

/** Replace the note's body below its frontmatter, keeping the frontmatter block
 *  byte-identical (a note with no block becomes just the body). */
export function setBody(text: string, newBody: string): string {
  const { fm } = splitFrontmatter(text);
  if (fm === "") return newBody;
  // One trailing newline whatever the cell carried (a Vault Folder body ends in one already),
  // so a read → write → read cycle is a fixed point; a CRLF note stays CRLF.
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  return `${fm.replace(/\r$/, "")}${nl}${nl}${newBody.replace(/(\r?\n)+$/, "")}${nl}`;
}

/** A one-line display of a body for the plan. */
function bodySnippet(body: string): string {
  const t = body.trim();
  if (t === "") return "(empty)";
  const first = t.split("\n")[0];
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

/** What writing `newBody` as the note's body would do, and the current body (a snippet). */
export function resolveBody(text: string, newBody: string): { action: "unchanged" | "update"; before: string } {
  const { body } = splitFrontmatter(text);
  return { action: body.trim() === newBody.trim() ? "unchanged" : "update", before: bodySnippet(body) };
}

export type PlanAction = "pending" | "add" | "update" | "unchanged" | "unreadable" | "refused";

export interface PlanRow {
  path: string;
  key: string;
  /** The normalized value to write. */
  value: YamlValue;
  /** A one-line display of `value`. */
  after: string;
  /** The note's current value, filled by Preview (else ""). */
  before: string;
  action: PlanAction;
  reason?: string;
}

/** The keys Write Properties will write: the `keys` CSV if given, else every column that
 *  isn't `path` or a read-only file.* built-in. */
export function writableKeys(cube: CubeValue, keysCsv: string): string[] {
  const present = new Set(cube.columns.map((c) => c.name));
  const listed = keysCsv.split(",").map((s) => s.trim()).filter(Boolean);
  // `note-body` is the body, never a frontmatter key — planPropertyWrites handles it apart.
  if (listed.length > 0) return listed.filter((k) => present.has(k) && k !== "path" && k !== NOTE_BODY);
  return cube.columns.map((c) => c.name).filter((k) => k !== "path" && k !== NOTE_BODY && !BUILTIN_READONLY.has(k));
}

const colType = (cube: CubeValue, name: string): FrameColType | undefined =>
  cube.columns.find((c) => c.name === name)?.type;

/** A one-line display of a normalized value for the plan's after/before cells. */
export function displayValue(v: YamlValue): string {
  if (v === null) return "";
  if (Array.isArray(v)) {
    if (isRows(v)) return `${v.length} row${v.length === 1 ? "" : "s"}`;
    return `[${(v as YamlScalarV[]).map((x) => renderScalar(x)).join(", ")}]`;
  }
  return renderScalar(v);
}

/** One plan row per (note × writable key). `path` names the note; a row with no `path`
 *  cell is skipped. `noteNames` turns matching string cells into `[[Name]]` links. */
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
  // The `note-body` column writes each note's BODY (not frontmatter) — one row per note
  // whose cell is a string; selected when `keys` is blank or names it.
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

/** Resolve what writing `value` to `key` would do to `text`, and the note's CURRENT value
 *  (a display string) — Preview + Run read this without writing. `add` (key absent),
 *  `unchanged` (the rendered lines already match), `update`, or `refused` (nested block). */
export function resolveKey(text: string, key: string, value: YamlValue): { action: "add" | "unchanged" | "update" | "refused"; before: string } {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== FENCE) return { action: "add", before: "" };
  let close = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === FENCE) { close = i; break; }
  if (close === -1) return { action: "add", before: "" };
  const interior = lines.slice(1, close);
  const span = scanKeys(interior).get(key);
  if (!span) return { action: "add", before: "" };
  const existing = interior.slice(span.start, span.end + 1);
  const before = span.shape === "scalar"
    ? (TOP_KEY.exec(existing[0])?.[2] ?? "").trim()
    : existing.slice(1).map((l) => l.trim()).filter(Boolean).join(", ");
  if (span.shape === "block") return { action: "refused", before };
  const rendered = renderKey(key, value);
  const same = existing.length === rendered.length && existing.every((l, i) => l === rendered[i]);
  return { action: same ? "unchanged" : "update", before };
}

/** The plan rows → the `plan` frame (path · key · before · after · action). */
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
