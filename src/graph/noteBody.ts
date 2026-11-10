// [[B1]] obsidianBet
// What a note's body holds as data, read the way Obsidian and its two common data plugins read it: checklist items
// (the Tasks plugin's emoji fields and Dataview's bracketed ones), pipe tables, and Dataview's `key:: value` fields.
// Pure text in, values out (`tree/specs/integrations/vault-read.md` § The body as data).

import { cubeFromColumns, frameFromCells, type CubeCell, type CubeValue, type FrameValue } from "./frame";
import { fencedLines } from "./managedBlock";
import { noteDateSerial } from "./nodes/dateSerial";
import type { FrontmatterScalar } from "./noteFrontmatter";

/** Quote and callout markers before a line's own text: `> > - [ ] task` is a task. */
const QUOTE_PREFIX = /^(?:\s*>)*/;
const HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const TASK = /^(\s*)(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/;
const TAG = /(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu;

/** A body's lines with code fences blanked, so nothing inside one reads as data, and the heading each line sits under. */
function proseLines(body: string): { text: string; heading: string | null }[] {
  const lines = body.split("\n");
  const fenced = fencedLines(lines);
  let heading: string | null = null;
  return lines.map((raw, i) => {
    if (fenced[i]) return { text: "", heading };
    const text = raw.replace(/\r$/, "").replace(QUOTE_PREFIX, "");
    const h = HEADING.exec(text);
    if (h) heading = h[1].trim() || null;
    return { text, heading };
  });
}

const withoutCodeSpans = (s: string): string => s.replace(/(`+)[^`]*?\1/g, " ");

// ─── Tasks ────────────────────────────────────────────────────────────────────

export interface BodyTask {
  task: string;
  done: boolean;
  /** The character between the brackets when it is not a space or an x: Obsidian's custom statuses (`/`, `-`, `>`). */
  status: string | null;
  due: number | null;
  scheduled: number | null;
  completed: number | null;
  priority: string | null;
  tags: string[];
  heading: string | null;
  /** The line in the note's file, counting from 1. */
  line: number;
}

/** The Tasks plugin's date emoji and Dataview's field names for the same three dates. */
const DATE_FIELDS: { key: "due" | "scheduled" | "completed"; emoji: string; names: string[] }[] = [
  { key: "due", emoji: "📅", names: ["due"] },
  { key: "scheduled", emoji: "⏳", names: ["scheduled"] },
  { key: "completed", emoji: "✅", names: ["completion", "completed"] },
];
const PRIORITIES: [string, string][] = [["🔺", "highest"], ["⏫", "high"], ["🔼", "medium"], ["🔽", "low"], ["⏬", "lowest"]];
/** The Tasks plugin's other fields, dropped from the text with their value: start, created, cancelled, recurrence, id, depends on, on completion. */
const OTHER_EMOJI_FIELDS = /\s*(?:🛫|➕|❌|🔁|🆔|⛔|🏁)️?\s*[^📅⏳✅🛫➕❌🔁🆔⛔🏁🔺⏫🔼🔽⏬[(]*/gu;
const DATE_TEXT = "(\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?)?)";

function readTask(rest: string): Omit<BodyTask, "done" | "status" | "heading" | "line"> {
  let text = rest;
  const dates: Record<"due" | "scheduled" | "completed", number | null> = { due: null, scheduled: null, completed: null };
  for (const { key, emoji, names } of DATE_FIELDS) {
    const forms = [
      new RegExp(`\\s*${emoji}\\uFE0F?\\s*${DATE_TEXT}`, "u"),
      new RegExp(`\\s*[\\[(]\\s*(?:${names.join("|")})\\s*::\\s*${DATE_TEXT}\\s*[\\])]`, "iu"),
    ];
    for (const re of forms) {
      const m = re.exec(text);
      if (!m) continue;
      if (dates[key] === null) dates[key] = noteDateSerial(m[1]);
      text = text.replace(re, "");
    }
  }
  let priority: string | null = null;
  for (const [emoji, word] of PRIORITIES) {
    if (!text.includes(emoji)) continue;
    priority ??= word;
    text = text.split(emoji).join("").replace(/️/g, "");
  }
  const named = /\s*[[(]\s*priority\s*::\s*([^\])]*?)\s*[\])]/i.exec(text);
  if (named) {
    priority ??= named[1].toLowerCase() || null;
    text = text.replace(named[0], "");
  }
  text = text.replace(OTHER_EMOJI_FIELDS, "");
  const tags: string[] = [];
  for (const m of withoutCodeSpans(text).matchAll(TAG)) if (!/^\p{N}+$/u.test(m[1]) && !tags.includes(m[1])) tags.push(m[1]);
  return { task: text.replace(/\s+/g, " ").trim(), ...dates, priority, tags };
}

/** Every checklist item of a note's body, top to bottom. `lineOffset` is how many lines of the file come before the body. */
export function readTasks(body: string, lineOffset = 0): BodyTask[] {
  const out: BodyTask[] = [];
  proseLines(body).forEach(({ text, heading }, i) => {
    const m = TASK.exec(text);
    if (!m) return;
    const mark = m[2];
    out.push({
      ...readTask(m[3]),
      done: mark === "x" || mark === "X",
      status: mark === " " || mark === "x" || mark === "X" ? null : mark,
      heading,
      line: lineOffset + i + 1,
    });
  });
  return out;
}

/** A note's tasks as a nested table, a row per task; null for a note with none. The columns a project note is likely
 *  to have of its own (status, due, priority, tags) carry `task` in their names, so an Unnest beside the note's
 *  properties keeps both readable. */
export function tasksCube(tasks: readonly BodyTask[]): CubeValue | null {
  if (tasks.length === 0) return null;
  return cubeFromColumns([
    { name: "task", type: "string", cells: tasks.map((t) => t.task) },
    { name: "done", type: "logical", cells: tasks.map((t) => t.done) },
    { name: "taskStatus", type: "string", cells: tasks.map((t) => t.status) },
    { name: "taskDue", type: "date", cells: tasks.map((t) => t.due) },
    { name: "taskScheduled", type: "date", cells: tasks.map((t) => t.scheduled) },
    { name: "taskCompleted", type: "date", cells: tasks.map((t) => t.completed) },
    { name: "taskPriority", type: "string", cells: tasks.map((t) => t.priority) },
    { name: "taskTags", type: "string", cells: tasks.map((t) => t.tags as CubeCell) },
    { name: "heading", type: "string", cells: tasks.map((t) => t.heading) },
    { name: "line", type: "number", cells: tasks.map((t) => t.line) },
  ]);
}

// ─── Ticking a task ───────────────────────────────────────────────────────────

/** A checklist line in three parts: up to the opening bracket, the mark, and the rest. */
const TASK_PARTS = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s+)(.*)$/;

export interface TaskMark {
  /** The item's line in the note's file, counting from 1, as `note-tasks` gives it. */
  line: number;
  done: boolean;
  /** The item's text as `note-tasks` read it; when given, the line must still hold that item. */
  task?: string;
}

interface TaskMarkPlan {
  action: "update" | "unchanged" | "refused";
  /** The mark as the note has it and as the write would leave it, brackets included. */
  before: string;
  after: string;
  reason?: string;
}

/** What setting one item's mark would do to a note. Only the character between the brackets ever changes: done makes
 *  it `x`, and not done clears an `x` to a space while leaving any other mark (`/` in progress, `-` cancelled) as it
 *  is. A line that is no checklist item, or whose item is no longer the one named, is refused. */
export function planTaskMark(text: string, mark: TaskMark): TaskMarkPlan {
  const lines = text.split("\n");
  const raw = lines[mark.line - 1];
  const fenced = raw === undefined ? false : fencedLines(lines)[mark.line - 1];
  const m = raw === undefined || fenced ? null : TASK_PARTS.exec(raw.replace(/\r$/, ""));
  if (!m) return { action: "refused", before: "", after: "", reason: `line ${mark.line} is not a checklist item` };
  const before = `[${m[2]}]`;
  if (mark.task !== undefined && readTask(m[4]).task !== mark.task.trim()) {
    return { action: "refused", before, after: before, reason: `the item at line ${mark.line} has changed` };
  }
  const ticked = m[2] === "x" || m[2] === "X";
  const next = mark.done ? (ticked ? m[2] : "x") : ticked ? " " : m[2];
  return { action: next === m[2] ? "unchanged" : "update", before, after: `[${next}]` };
}

/** The note with each mark set that `planTaskMark` would update, every other character as it was. */
export function setTaskMarks(text: string, marks: readonly TaskMark[]): string {
  const lines = text.split("\n");
  for (const mark of marks) {
    const plan = planTaskMark(text, mark);
    if (plan.action !== "update") continue;
    const raw = lines[mark.line - 1];
    const cr = raw.endsWith("\r") ? "\r" : "";
    const m = TASK_PARTS.exec(raw.replace(/\r$/, ""))!;
    lines[mark.line - 1] = `${m[1]}${plan.after.slice(1, 2)}${m[3]}${m[4]}${cr}`;
  }
  return lines.join("\n");
}

// ─── Tables ───────────────────────────────────────────────────────────────────

interface BodyTable {
  heading: string | null;
  headers: string[];
  rows: string[][];
}

const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** A pipe row's cells: the outer pipes are optional, `\|` is a pipe inside a cell, and a pipe inside a code span or a
 *  `[[link|alias]]` stays with its cell. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let code = false;
  let link = 0;
  const s = line.trim();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") { cell += "|"; i++; continue; }
    if (ch === "`") code = !code;
    if (!code && ch === "[" && s[i + 1] === "[") link++;
    if (!code && ch === "]" && s[i + 1] === "]" && link > 0) link--;
    if (ch === "|" && !code && link === 0) { cells.push(cell); cell = ""; continue; }
    cell += ch;
  }
  cells.push(cell);
  if (s.startsWith("|")) cells.shift();
  if (s.endsWith("|") && !s.endsWith("\\|")) cells.pop();
  return cells.map((c) => c.trim());
}

/** Every pipe table of a note's body: a header row, the dashes under it, then rows until a line with no pipe. */
export function readTables(body: string): BodyTable[] {
  const lines = proseLines(body);
  const out: BodyTable[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = lines[i].text;
    if (!head.includes("|") || !DELIMITER_ROW.test(lines[i + 1].text) || !lines[i + 1].text.includes("-")) continue;
    const headers = splitRow(head);
    if (headers.length !== splitRow(lines[i + 1].text).length) continue;
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].text.trim() !== "" && lines[j].text.includes("|"); j++) {
      const cells = splitRow(lines[j].text);
      rows.push(headers.map((_, k) => cells[k] ?? ""));
    }
    out.push({ heading: lines[i].heading, headers, rows });
    i = j - 1;
  }
  return out;
}

/** A note's tables as one nested table: their rows stacked, a column per header any of them has (blank where a table
 *  lacks it), each column typed as an imported file's is, and a first column `heading` naming the heading each row's
 *  table sits under. A table's own `heading` column keeps its place and no other is added. Null for a note with none. */
export function tablesFrame(tables: readonly BodyTable[]): FrameValue | null {
  if (tables.length === 0) return null;
  const own = tables.some((t) => t.headers.includes("heading"));
  const names: string[] = own ? [] : ["heading"];
  for (const t of tables) for (const h of t.headers) if (!names.includes(h)) names.push(h);
  const rows: (string | null)[][] = [];
  for (const t of tables) {
    for (const r of t.rows) {
      rows.push(names.map((n, k) => {
        if (!own && k === 0) return t.heading;
        const at = t.headers.indexOf(n);
        return at < 0 ? null : r[at];
      }));
    }
  }
  return frameFromCells(names, rows);
}

// ─── Inline fields ────────────────────────────────────────────────────────────

/** `Key:: value` on a line of its own, after an optional list marker; the key may be bold or italic. */
const LINE_FIELD = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?([*_~]*[^\s:[\]()*_~][^:[\]()]*?[*_~]*)::(?:\s+(.*))?$/;
/** `[key:: value]` or `(key:: value)` anywhere in a line. */
const BRACKET_FIELD = /[[(]\s*([^[\]():]+?)\s*::\s*([^\])]*?)\s*[\])]/g;

/** A field's text as a value: a number, TRUE or FALSE, a date, text in quotes without them, else the text. */
function readFieldValue(text: string): { value: FrontmatterScalar; kind: "number" | "logical" | "date" | "string" } {
  const t = text.trim();
  if (t === "") return { value: null, kind: "string" };
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(t)) return { value: Number(t), kind: "number" };
  if (/^(?:true|false)$/i.test(t)) return { value: t.toLowerCase() === "true", kind: "logical" };
  const serial = noteDateSerial(t);
  if (serial !== null) return { value: serial, kind: "date" };
  const quoted = /^"(.*)"$/.exec(t);
  return { value: quoted ? quoted[1] : t, kind: "string" };
}

export interface BodyField {
  key: string;
  value: FrontmatterScalar | FrontmatterScalar[];
  /** As the frontmatter reader names a guess: `date` and `datelist` mark dates held as serials. */
  guessed: string;
}

/** Every inline field of a note's body outside its tasks, a key written more than once holding a list. */
export function readInlineFields(body: string): BodyField[] {
  const found = new Map<string, { value: FrontmatterScalar; kind: string }[]>();
  const add = (rawKey: string, rawValue: string): void => {
    const key = rawKey.replace(/^[*_~]+|[*_~]+$/g, "").trim();
    if (key === "") return;
    const read = readFieldValue(rawValue);
    if (read.value === null) return;
    found.set(key, [...(found.get(key) ?? []), read]);
  };
  for (const { text } of proseLines(body)) {
    if (text.trim() === "" || TASK.test(text)) continue;
    const prose = withoutCodeSpans(text);
    const line = LINE_FIELD.exec(prose);
    if (line) { add(line[1], line[2] ?? ""); continue; }
    for (const m of prose.matchAll(BRACKET_FIELD)) add(m[1], m[2]);
  }
  return [...found].map(([key, reads]): BodyField => {
    if (reads.length === 1) return { key, value: reads[0].value, guessed: reads[0].kind };
    const dates = reads.every((r) => r.kind === "date");
    return { key, value: reads.map((r) => r.value), guessed: dates ? "datelist" : "list" };
  });
}
