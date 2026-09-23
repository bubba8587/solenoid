// [[C101]] onePatchPath
import { yamlScalar } from "./obsidianMarkdown";
import { isFrameValue, isCubeValue, type CubeCell, type CubeValue, type FrameColType, type FrameValue } from "./frame";
import { formatDateSerial } from "./nodes/dateSerial";

export type YamlScalarV = string | number | boolean | null;
export type YamlRowV = YamlScalarV | YamlScalarV[];
export type YamlValue = YamlScalarV | YamlScalarV[] | Record<string, YamlRowV>[];

export interface PatchResult { text: string; }

const FENCE = "---";
const TOP_KEY = /^([A-Za-z0-9_][\w .-]*?):\s*(.*)$/;

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

function renderRow(row: Record<string, YamlRowV>): string[] {
  const out: string[] = [];
  for (const [k, val] of Object.entries(row)) {
    const lead = out.length === 0 ? "  - " : "    ";
    if (Array.isArray(val)) {
      if (val.length === 0) { out.push(`${lead}${k}: []`); continue; }
      out.push(`${lead}${k}:`, ...val.map((x) => `      - ${renderScalar(x)}`));
    } else {
      out.push(`${lead}${k}: ${renderScalar(val)}`);
    }
  }
  return out;
}

export function renderKey(key: string, v: YamlValue): string[] {
  if (isRows(v)) return [`${key}:`, ...v.flatMap(renderRow)];
  if (Array.isArray(v)) {
    if (v.length === 0) return [`${key}: []`];
    return [`${key}:`, ...(v as YamlScalarV[]).map((x) => `  - ${renderScalar(x)}`)];
  }
  return [`${key}: ${renderScalar(v)}`];
}

interface KeySpan { start: number; end: number; scalar: boolean; }

function scanKeys(interior: string[]): Map<string, KeySpan> {
  const spans = new Map<string, KeySpan>();
  const starts: { key: string; line: number; rest: string }[] = [];
  for (let i = 0; i < interior.length; i++) {
    if (/^\s/.test(interior[i])) continue;
    const m = TOP_KEY.exec(interior[i]);
    if (m) starts.push({ key: m[1].trim(), line: i, rest: m[2] });
  }
  for (let s = 0; s < starts.length; s++) {
    const { key, line, rest } = starts[s];
    const end = (s + 1 < starts.length ? starts[s + 1].line : interior.length) - 1;
    const scalar = rest.trim() !== "" || interior.slice(line + 1, end + 1).every((l) => l.trim() === "");
    if (!spans.has(key)) spans.set(key, { start: line, end, scalar });
  }
  return spans;
}

export function patchFrontmatter(text: string, patch: Record<string, YamlValue>): PatchResult {
  const keys = Object.keys(patch);
  if (keys.length === 0) return { text };

  const lines = text.split("\n");

  if (lines[0]?.trim() !== FENCE) {
    const rendered = keys.flatMap((k) => renderKey(k, patch[k]));
    const block = [FENCE, ...rendered, FENCE, ""].join("\n");
    return { text: block + text };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) { close = i; break; }
  }
  if (close === -1) {
    const rendered = keys.flatMap((k) => renderKey(k, patch[k]));
    return { text: [FENCE, ...rendered, FENCE, "", ...lines].join("\n") };
  }

  const interior = lines.slice(1, close);
  const spans = scanKeys(interior);

  const replacements = new Map<number, { end: number; lines: string[] }>();
  const appends: string[] = [];
  for (const key of keys) {
    const span = spans.get(key);
    if (span) {
      replacements.set(span.start, { end: span.end, lines: renderKey(key, patch[key]) });
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
  return { text: rebuilt.join("\n") };
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
  const lines = text.split("\n");
  if (lines[0]?.trim() !== FENCE) return { action: "add", before: "" };
  let close = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === FENCE) { close = i; break; }
  if (close === -1) return { action: "add", before: "" };
  const interior = lines.slice(1, close);
  const span = scanKeys(interior).get(key);
  if (!span) return { action: "add", before: "" };
  const existing = interior.slice(span.start, span.end + 1);
  const before = span.scalar
    ? (TOP_KEY.exec(existing[0])?.[2] ?? "").trim()
    : existing.slice(1).map((l) => l.trim()).filter(Boolean).join(", ");
  const rendered = renderKey(key, value);
  const same = existing.length === rendered.length && existing.every((l, i) => l === rendered[i]);
  return { action: same ? "unchanged" : "update", before };
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
