// TaskNotes (the Obsidian plugin) over its local HTTP API. URL builders + PARSERS are pure
// and fixture-tested; the node owns the fetch, the paging loop and the cache. One fixture
// per endpoint in taskNotesApi.test.ts. Field shapes follow the plugin's TaskInfo type.

import { cubeFromColumns, type CubeValue, type CubeCell, type FrameValue, type FrameCell } from "./frame";
import { parseDateToSerial, jsDateToSerial } from "./nodes/dateSerial";

export const TASKNOTES_DEFAULT_URL = "http://localhost:8080";
/** The apiKeyStore slot the bearer token lives in. */
export const TASKNOTES_KEY_ID = "tasknotes";
/** The API's page cap. */
export const TASKS_PAGE = 200;

export type TaskNotesProvider = "tasks" | "calendar" | "stats";

export const TASKNOTES_PROVIDER_META = {
  tasks:    { label: "Tasks",    description: "Every task as one row of a Cube: path, title, status, priority, due, scheduled, estimate, tracked minutes, archived, then projects, contexts, tags and blocked-by as lists, time entries and completed instances as nested tables, and each user field." },
  calendar: { label: "Calendar", description: "Calendar events between two dates as a Frame: title, start, end, source." },
  stats:    { label: "Stats",    description: "Task counts: total, completed, active, overdue, archived." },
} satisfies Record<TaskNotesProvider, { label: string; description: string }>;

function base(url: string): string {
  const t = url.trim() || TASKNOTES_DEFAULT_URL;
  // "localhost:8080" typed without a scheme is a bare host, not a URL.
  return (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`).replace(/\/+$/, "");
}

export function tasksUrl(url: string, offset: number, limit = TASKS_PAGE): string {
  return `${base(url)}/api/tasks?limit=${Math.max(1, Math.min(TASKS_PAGE, limit))}&offset=${Math.max(0, offset)}`;
}

export function eventsUrl(url: string, fromSerial: number, toSerial: number): string {
  const p = new URLSearchParams({ start: serialToIsoDate(fromSerial) + "T00:00:00", end: serialToIsoDate(toSerial) + "T23:59:59" });
  return `${base(url)}/api/calendars/events?${p.toString()}`;
}

export function statsUrl(url: string): string {
  return `${base(url)}/api/stats`;
}

/** The request headers: a bearer token when one is set. */
export function authHeaders(token: string): Record<string, string> {
  const t = token.trim();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ─── Value parsing ────────────────────────────────────────────────────────────────

/** A date (`YYYY-MM-DD`) or an ISO datetime → a serial; null for blank / unreadable. */
export function isoToSerial(s: unknown): number | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const t = s.trim();
  if (/T/.test(t)) {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? jsDateToSerial(new Date(ms)) : null;
  }
  const n = parseDateToSerial(t);
  return Number.isFinite(n) ? n : null;
}

function serialToIsoDate(serial: number): string {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** `[[Name]]`, `[[folder/Name|alias]]`, `folder/Name.md` → `Name`. */
export function linkName(s: unknown): string {
  if (typeof s !== "string") return "";
  let t = s.trim();
  const m = /^\[\[([^\]]*)\]\]$/.exec(t);
  if (m) t = m[1];
  t = t.split("|")[0].split("#")[0];
  t = t.split("/").pop() ?? t;
  return t.replace(/\.md$/i, "").trim();
}

/** The API envelope: `{success, data}` or `{success:false, error}`. Throws the error text. */
export function unwrap(text: string): unknown {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("TaskNotes: the reply was not JSON"); }
  const env = json as { success?: boolean; data?: unknown; error?: unknown };
  if (env && typeof env === "object" && "success" in env) {
    if (env.success === false) throw new Error(`TaskNotes: ${String(env.error ?? "request failed")}`);
    return env.data;
  }
  return json;
}

// ─── Tasks → cube ─────────────────────────────────────────────────────────────────

export interface TaskRecord {
  path: string;
  title: string;
  status: string | null;
  priority: string | null;
  due: number | null;
  scheduled: number | null;
  completed: number | null;
  timeEstimate: number | null;
  trackedMinutes: number | null;
  archived: boolean;
  projects: string[];
  contexts: string[];
  tags: string[];
  blockedBy: string[];
  timeEntries: FrameValue;
  completeInstances: FrameValue;
  created: number | null;
  modified: number | null;
  user: Record<string, CubeCell>;
}

const strList = (v: unknown, map: (s: unknown) => string = (s) => String(s ?? "").trim()): string[] =>
  Array.isArray(v) ? v.map(map).filter(Boolean) : [];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function timeEntriesFrame(entries: unknown): { frame: FrameValue; minutes: number | null } {
  const rows = Array.isArray(entries) ? entries as Record<string, unknown>[] : [];
  const start: FrameCell[] = [], end: FrameCell[] = [], minutes: FrameCell[] = [], desc: FrameCell[] = [];
  let total: number | null = rows.length ? 0 : null;
  for (const e of rows) {
    const s = isoToSerial(e.startTime), f = isoToSerial(e.endTime);
    const mins = s != null && f != null ? Math.round((f - s) * 1440) : num(e.duration);
    start.push(s); end.push(f); minutes.push(mins); desc.push(typeof e.description === "string" ? e.description : null);
    if (mins != null && total != null) total += mins;
  }
  return {
    frame: { __frame: true, columns: [
      { name: "Start", type: "date", values: start }, { name: "End", type: "date", values: end },
      { name: "Minutes", type: "number", values: minutes }, { name: "Description", type: "string", values: desc },
    ] },
    minutes: total,
  };
}

function instancesFrame(dates: unknown): FrameValue {
  const vals: FrameCell[] = Array.isArray(dates) ? dates.map(isoToSerial) : [];
  return { __frame: true, columns: [{ name: "Date", type: "date", values: vals }] };
}

/** A user (custom) field → a cube cell: scalars as typed, a list → a list cell, an object
 *  → its JSON text (never a dropped key). */
function userCell(v: unknown): CubeCell {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") {
    const d = /^\d{4}-\d{2}-\d{2}(T|$)/.test(v) ? isoToSerial(v) : null;
    return d ?? v;
  }
  if (Array.isArray(v)) return v.map((x) => userCell(x) as FrameCell);
  return JSON.stringify(v);
}

const BUILT_IN = new Set([
  "id", "path", "title", "status", "priority", "due", "scheduled", "completedDate", "timeEstimate", "timeEntries",
  "totalTrackedTime", "archived", "projects", "contexts", "tags", "blockedBy", "complete_instances", "dateCreated",
  "dateModified", "details", "customProperties", "basesData", "blocking", "isBlocked", "isBlocking", "hasSubtasks",
  "sortOrder", "reminders", "attachments", "recurrence", "recurrence_anchor", "skipped_instances", "recurrence_parent",
  "occurrence_date", "occurrence_materialization", "occurrence_next_trigger", "occurrence_template",
  "occurrence_past_horizon", "occurrence_future_horizon", "icsEventId", "googleCalendarEventId",
  "googleCalendarExceptionEventId", "googleCalendarExceptionOriginalScheduled", "googleCalendarMovedOriginalDates",
]);

export function taskRecord(raw: Record<string, unknown>): TaskRecord {
  const te = timeEntriesFrame(raw.timeEntries);
  const user: Record<string, CubeCell> = {};
  const custom = raw.customProperties;
  if (custom && typeof custom === "object") for (const [k, v] of Object.entries(custom as Record<string, unknown>)) user[k] = userCell(v);
  for (const [k, v] of Object.entries(raw)) if (!BUILT_IN.has(k) && !(k in user)) user[k] = userCell(v);
  const blocked = Array.isArray(raw.blockedBy)
    ? (raw.blockedBy as unknown[]).map((d) => linkName(typeof d === "object" && d ? (d as { uid?: unknown }).uid : d)).filter(Boolean)
    : [];
  return {
    path: String(raw.path ?? raw.id ?? ""),
    title: String(raw.title ?? ""),
    status: typeof raw.status === "string" ? raw.status : null,
    priority: typeof raw.priority === "string" ? raw.priority : null,
    due: isoToSerial(raw.due),
    scheduled: isoToSerial(raw.scheduled),
    completed: isoToSerial(raw.completedDate),
    timeEstimate: num(raw.timeEstimate),
    trackedMinutes: num(raw.totalTrackedTime) ?? te.minutes,
    archived: raw.archived === true,
    projects: strList(raw.projects, linkName),
    contexts: strList(raw.contexts),
    tags: strList(raw.tags),
    blockedBy: blocked,
    timeEntries: te.frame,
    completeInstances: instancesFrame(raw.complete_instances),
    created: isoToSerial(raw.dateCreated),
    modified: isoToSerial(raw.dateModified),
    user,
  };
}

export interface TasksPage {
  tasks: TaskRecord[];
  total: number | null;
  hasMore: boolean;
  nextOffset: number;
}

/** One `GET /api/tasks` page. */
export function parseTasksPage(text: string, offset: number): TasksPage {
  const data = unwrap(text) as { tasks?: unknown; pagination?: { total?: unknown; hasMore?: unknown; limit?: unknown } } | null;
  const list = Array.isArray(data?.tasks) ? data!.tasks as Record<string, unknown>[] : [];
  const tasks = list.map(taskRecord);
  const pg = data?.pagination;
  const total = num(pg?.total);
  const hasMore = pg?.hasMore === true || (total != null && offset + tasks.length < total);
  return { tasks, total, hasMore: hasMore && tasks.length > 0, nextOffset: offset + tasks.length };
}

/** The Tasks cube: built-ins first, then every user field in first-seen order. */
export function tasksToCube(tasks: readonly TaskRecord[]): CubeValue {
  const col = (name: string, cells: CubeCell[], type?: FrameValue["columns"][number]["type"]) => ({ name, cells, ...(type ? { type } : {}) });
  const userKeys: string[] = [];
  for (const t of tasks) for (const k of Object.keys(t.user)) if (!userKeys.includes(k)) userKeys.push(k);
  return cubeFromColumns([
    col("path", tasks.map((t) => t.path), "string"),
    col("title", tasks.map((t) => t.title), "string"),
    col("status", tasks.map((t) => t.status), "string"),
    col("priority", tasks.map((t) => t.priority), "string"),
    col("due", tasks.map((t) => t.due), "date"),
    col("scheduled", tasks.map((t) => t.scheduled), "date"),
    col("completed", tasks.map((t) => t.completed), "date"),
    col("timeEstimate", tasks.map((t) => t.timeEstimate), "number"),
    col("trackedMinutes", tasks.map((t) => t.trackedMinutes), "number"),
    col("archived", tasks.map((t) => t.archived), "logical"),
    col("projects", tasks.map((t) => t.projects as CubeCell)),
    col("contexts", tasks.map((t) => t.contexts as CubeCell)),
    col("tags", tasks.map((t) => t.tags as CubeCell)),
    col("blockedBy", tasks.map((t) => t.blockedBy as CubeCell)),
    col("timeEntries", tasks.map((t) => t.timeEntries)),
    col("complete_instances", tasks.map((t) => t.completeInstances)),
    col("created", tasks.map((t) => t.created), "date"),
    col("modified", tasks.map((t) => t.modified), "date"),
    ...userKeys.map((k) => col(k, tasks.map((t) => (k in t.user ? t.user[k] : null)))),
  ]);
}

// ─── Calendar events → frame ──────────────────────────────────────────────────────

export function parseEvents(text: string): FrameValue {
  const data = unwrap(text) as { events?: unknown } | unknown[] | null;
  const list = Array.isArray(data) ? data : Array.isArray((data as { events?: unknown })?.events) ? (data as { events: unknown[] }).events : [];
  const title: FrameCell[] = [], start: FrameCell[] = [], end: FrameCell[] = [], source: FrameCell[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    title.push(String(raw.title ?? raw.summary ?? ""));
    start.push(isoToSerial(raw.start ?? raw.startTime));
    end.push(isoToSerial(raw.end ?? raw.endTime));
    const src = raw.source ?? raw.provider ?? raw.calendar ?? raw.subscription;
    source.push(src == null ? null : String(src));
  }
  return { __frame: true, columns: [
    { name: "Title", type: "string", values: title }, { name: "Start", type: "date", values: start },
    { name: "End", type: "date", values: end }, { name: "Source", type: "string", values: source },
  ] };
}

// ─── Stats → scalars ──────────────────────────────────────────────────────────────

export interface TaskStats { total: number | null; completed: number | null; active: number | null; overdue: number | null; archived: number | null }

export function parseStats(text: string): TaskStats {
  const d = (unwrap(text) ?? {}) as Record<string, unknown>;
  return { total: num(d.total), completed: num(d.completed), active: num(d.active), overdue: num(d.overdue), archived: num(d.archived) };
}

/** The task counts as one { Status | Count } frame, a row per count. */
export function statsToFrame(s: TaskStats): FrameValue {
  const rows: Array<[string, number | null]> = [
    ["Total", s.total], ["Completed", s.completed], ["Active", s.active], ["Overdue", s.overdue], ["Archived", s.archived],
  ];
  return { __frame: true, columns: [
    { name: "Status", type: "string", values: rows.map((r) => r[0]) },
    { name: "Count", type: "number", values: rows.map((r) => r[1]) },
  ] };
}

// ─── Write Tasks (F6): rows → API payloads + the plan frame ───────────────────────

/** The API's task fields a row may set; `path` picks the row's task (PUT), never a field. */
export const WRITABLE_TASK_KEYS = [
  "title", "details", "status", "priority", "due", "scheduled", "tags", "contexts", "projects",
  "recurrence", "recurrence_anchor", "timeEstimate", "blockedBy",
] as const;
const WRITABLE = new Set<string>(WRITABLE_TASK_KEYS);
const DATE_KEYS = new Set(["due", "scheduled"]);
const LIST_KEYS = new Set(["tags", "contexts", "projects"]);

function serialToIsoDateOnly(serial: number): string {
  return serialToIsoDate(serial);
}

/** A cube/frame cell → the API's JSON for `key`: dates from serials, lists as arrays
 *  (a comma-separated text splits), blockedBy names as FINISHTOSTART links, numbers as
 *  minutes, everything else as its text. Blank → undefined (the key is not sent). */
export function cellToTaskField(key: string, cell: unknown): unknown {
  if (cell == null || cell === "") return undefined;
  if (DATE_KEYS.has(key)) {
    if (typeof cell === "number") return serialToIsoDateOnly(cell);
    const n = isoToSerial(String(cell));
    return n == null ? undefined : serialToIsoDateOnly(n);
  }
  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean)
      : String(v).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (LIST_KEYS.has(key)) return asList(cell);
  if (key === "blockedBy") return asList(cell).map((name) => ({ uid: `[[${linkName(name) || name}]]`, reltype: "FINISHTOSTART" }));
  if (key === "timeEstimate") { const n = typeof cell === "number" ? cell : Number(cell); return Number.isFinite(n) ? n : undefined; }
  if (typeof cell === "object") return undefined; // a nested table has no API field
  return typeof cell === "string" ? cell : String(cell);
}

export interface TaskWritePlanRow {
  path: string;
  title: string;
  /** create (no path) · update (path) · skip (nothing to send) */
  action: "create" | "update" | "skip";
  /** The API payload for this row (the fields that will be sent). */
  payload: Record<string, unknown>;
}

/** One row of a cube/frame (column name → cell) → its write plan. `keys` limits the
 *  columns sent ("" = every writable column present); `path` always addresses, never
 *  writes; a create needs a title. */
export function planTaskRow(row: Record<string, unknown>, keys: readonly string[]): TaskWritePlanRow {
  const path = typeof row.path === "string" ? row.path.trim() : "";
  const wanted = keys.length ? keys.filter((k) => WRITABLE.has(k)) : Object.keys(row).filter((k) => WRITABLE.has(k));
  const payload: Record<string, unknown> = {};
  for (const k of wanted) {
    const v = cellToTaskField(k, row[k]);
    if (v !== undefined) payload[k] = v;
  }
  const title = typeof payload.title === "string" ? payload.title : (typeof row.title === "string" ? row.title : "");
  const sent = Object.keys(payload).length;
  const action: TaskWritePlanRow["action"] = path ? (sent ? "update" : "skip") : (title.trim() ? "create" : "skip");
  if (action === "create" && payload.title === undefined) payload.title = title;
  return { path, title, action, payload };
}

/** Every row of a cube (or a frame widened to one) → its plan. */
export function planTaskWrites(cube: CubeValue, keys: readonly string[]): TaskWritePlanRow[] {
  const rows = cube.columns.reduce((m, c) => Math.max(m, c.cells.length), 0);
  const out: TaskWritePlanRow[] = [];
  for (let i = 0; i < rows; i++) {
    const row: Record<string, unknown> = {};
    for (const c of cube.columns) row[c.name] = c.cells[i] ?? null;
    out.push(planTaskRow(row, keys));
  }
  return out;
}

/** The `plan` frame a Write Tasks card emits: path · title · action · fields. */
export function taskPlanFrame(plan: readonly TaskWritePlanRow[], resolved?: ReadonlyMap<number, string>): FrameValue {
  return { __frame: true, columns: [
    { name: "path", type: "string", values: plan.map((r) => r.path || null) },
    { name: "title", type: "string", values: plan.map((r) => r.title || null) },
    { name: "action", type: "string", values: plan.map((r, i) => resolved?.get(i) ?? r.action) },
    { name: "fields", type: "string", values: plan.map((r) => Object.keys(r.payload).join(", ") || null) },
  ] };
}

/** `PUT /api/tasks/:id` — the id is the URL-encoded task path. */
export function taskUrl(url: string, path: string): string {
  return `${base(url)}/api/tasks/${encodeURIComponent(path)}`;
}

export function createTaskUrl(url: string): string {
  return `${base(url)}/api/tasks`;
}

/** Parse the plugin's reply to a create/update: the task's path when present. */
export function parseWrittenTaskPath(text: string): string | null {
  try {
    const d = unwrap(text) as { path?: unknown; task?: { path?: unknown } } | null;
    const p = d?.path ?? d?.task?.path;
    return typeof p === "string" ? p : null;
  } catch { return null; }
}
