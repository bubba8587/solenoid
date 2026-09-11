import { ClassicPreset } from "rete";
import { dateIn, cubeOut, frameOut } from "./shared";
import { connectionStore, scheduleConnectionRecalc, requestNetwork, trackInflight } from "../connectionStore";
import { settingsStore } from "../settingsStore";
import { apiKeyStore } from "../apiKeyStore";
import { fetchText } from "../httpBridge";
import { cubeFromColumns, isCubeValue, type CubeValue, type FrameValue } from "../frame";
import { isSolError, type SolError } from "../errorValue";
import {
  TASKNOTES_KEY_ID, TASKS_PAGE, tasksUrl, eventsUrl, statsUrl, authHeaders,
  parseTasksPage, tasksToCube, parseEvents, parseStats, statsToFrame,
  planTaskWrites, taskPlanFrame, taskUrl, createTaskUrl, taskRecord, unwrap, cellToTaskField,
  type TaskNotesProvider, type TaskRecord, type TaskStats, type TaskWritePlanRow,
} from "../taskNotesApi";
import { cubeIn, frameOut as frameOutPort } from "./shared";
import { fetchJson } from "../httpBridge";
import { type Shape } from "../frameShape";

// TaskNotes (Obsidian plugin) over its local HTTP API — the Obsidian bundle's item F.
// One connection node, a provider select: Tasks → a cube, Calendar → a frame between two
// dates, Stats → scalars. The WebSource sync-background fetch pattern, so it rides the
// C2 network gate; the provider switch reshapes the sockets (the op-card pattern).

const INPUTS: Record<TaskNotesProvider, string[]> = { tasks: [], calendar: ["from", "to"], stats: [] };
const OUTPUTS: Record<TaskNotesProvider, string[]> = {
  tasks: ["tasks"], calendar: ["events"], stats: ["stats"],
};

const EMPTY_TASKS: CubeValue = cubeFromColumns([{ name: "title", cells: [] }]);
const EMPTY_STATS: FrameValue = statsToFrame({ total: null, completed: null, active: null, overdue: null, archived: null });
const EMPTY_EVENTS: FrameValue = { __frame: true, columns: [
  { name: "Title", type: "string", values: [] }, { name: "Start", type: "date", values: [] },
  { name: "End", type: "date", values: [] }, { name: "Source", type: "string", values: [] },
] };

function todaySerial(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
}

export class TaskNotesNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    tasks: "One row per task. Lists (projects, contexts, tags, blocked-by) are list cells; time entries and completed instances are nested tables. Filter, Sort and Get Column read the scalar columns; Unnest opens a nested one.",
    from: "First day of the calendar window. Unwired, a year back.",
    to: "Last day of the calendar window. Unwired, a year ahead.",
    events: "One row per calendar event in the window: title, start, end, source.",
    stats: "The task counts as a frame: Status and Count, a row each for total, completed, active, overdue and archived.",
  };

  label: string;
  provider: TaskNotesProvider;
  /** Minutes, 0 = off — the component runs the timer. */
  refreshMinutes: number;
  width = 240; height = 200;
  /** Read by the component; never persisted. */
  cachedTasks: TaskRecord[] | null = null;
  cachedEvents: FrameValue | null = null;
  cachedStats: TaskStats | null = null;
  private _lastKey: string | undefined;

  constructor(init?: { label?: string; provider?: TaskNotesProvider; refreshMinutes?: number }) {
    super("TaskNotes");
    this.label = init?.label ?? "TaskNotes";
    this.provider = init?.provider === "calendar" || init?.provider === "stats" ? init.provider : "tasks";
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.applyProvider();
  }

  /** The socket keys a switch to `next` would remove (inputs + outputs). Callers on a
   *  live graph prune their cables BEFORE calling setProvider (onePrunePath). */
  keysDroppedBySwitch(next: TaskNotesProvider): { inputs: string[]; outputs: string[] } {
    return {
      inputs: INPUTS[this.provider].filter((k) => !INPUTS[next].includes(k)),
      outputs: OUTPUTS[this.provider].filter((k) => !OUTPUTS[next].includes(k)),
    };
  }

  setProvider(next: TaskNotesProvider): void {
    if (next === this.provider) return;
    this.provider = next;
    this.applyProvider();
    this._lastKey = undefined;
  }

  private applyProvider(): void {
    for (const k of Object.keys(this.inputs)) if (!INPUTS[this.provider].includes(k)) this.removeInput(k);
    for (const k of Object.keys(this.outputs)) if (!OUTPUTS[this.provider].includes(k)) this.removeOutput(k);
    if (this.provider === "calendar") {
      if (!this.inputs.from) this.addInput("from", dateIn("From"));
      if (!this.inputs.to) this.addInput("to", dateIn("To"));
      if (!this.outputs.events) this.addOutput("events", frameOut("Events"));
    } else if (this.provider === "tasks") {
      if (!this.outputs.tasks) this.addOutput("tasks", cubeOut("Tasks"));
    } else {
      if (!this.outputs.stats) this.addOutput("stats", frameOut("Stats"));
    }
    this.height = this.provider === "calendar" ? 230 : 200;
  }

  private apiUrl(): string { return settingsStore.get("taskNotesUrl"); }
  private headers(): Record<string, string> { return authHeaders(apiKeyStore.get(TASKNOTES_KEY_ID)); }

  data(inputs: { from?: (number | null)[]; to?: (number | null)[] }): Record<string, unknown> {
    let from = 0, to = 0;
    let have = true;
    if (this.provider === "calendar") {
      // A wired blank date is "no window yet"; unwired = a year either side of today (show
      // essentially everything, since the API needs a bounded window).
      const f = inputs.from ? inputs.from[0] : todaySerial() - 365;
      const t = inputs.to ? inputs.to[0] : todaySerial() + 365;
      have = typeof f === "number" && typeof t === "number" && Number.isFinite(f) && Number.isFinite(t);
      if (have) { from = Math.min(f as number, t as number); to = Math.max(f as number, t as number); }
    }
    const key = connectionStore.key(this.id, have ? `${this.provider}|${this.apiUrl()}|${from}|${to}` : "");
    if (key !== this._lastKey) {
      if (!have) {
        this._lastKey = key;
        connectionStore.setState(this.id, { status: "idle" });
      } else if (requestNetwork(this.id)) {
        this._lastKey = key;
        void trackInflight(this.fetchProvider(from, to)).then(() => scheduleConnectionRecalc());
      }
    }
    switch (this.provider) {
      case "tasks": return { tasks: this.cachedTasks ? tasksToCube(this.cachedTasks) : EMPTY_TASKS };
      case "calendar": return { events: this.cachedEvents ?? EMPTY_EVENTS };
      default: return { stats: this.cachedStats ? statsToFrame(this.cachedStats) : EMPTY_STATS };
    }
  }

  private async fetchProvider(from: number, to: number): Promise<void> {
    connectionStore.setState(this.id, { status: "loading" });
    const provider = this.provider;
    try {
      if (provider === "tasks") {
        const all: TaskRecord[] = [];
        let offset = 0;
        for (;;) {
          const { text } = await fetchText(tasksUrl(this.apiUrl(), offset, TASKS_PAGE), { headers: this.headers() });
          const page = parseTasksPage(text, offset);
          all.push(...page.tasks);
          if (!page.hasMore || page.nextOffset === offset) break;
          offset = page.nextOffset;
        }
        this.cachedTasks = all;
        connectionStore.setState(this.id, { status: "ok", rows: all.length, fetchedAt: Date.now() });
      } else if (provider === "calendar") {
        const { text } = await fetchText(eventsUrl(this.apiUrl(), from, to), { headers: this.headers() });
        this.cachedEvents = parseEvents(text);
        connectionStore.setState(this.id, { status: "ok", rows: this.cachedEvents.columns[0].values.length, fetchedAt: Date.now() });
      } else {
        const { text } = await fetchText(statsUrl(this.apiUrl()), { headers: this.headers() });
        this.cachedStats = parseStats(text);
        connectionStore.setState(this.id, { status: "ok", fetchedAt: Date.now() });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A 401 means the plugin wants its bearer token.
      const friendly = /HTTP 401/.test(msg) ? "Token rejected. Paste the plugin's API token." : /Failed to fetch|ECONNREFUSED|error sending request|NetworkError|Couldn't fetch this URL/i.test(msg) ? "Can't reach TaskNotes. Install the plugin in the vault Obsidian has open, turn on its HTTP API, and check the port in Settings." : msg;
      connectionStore.setState(this.id, { status: "error", message: friendly });
    }
  }
}

// ─── WRITE TASKS (F6): rows → POST /api/tasks, or PUT /api/tasks/:id when the row carries
// `path`. Run-button only (sinkRunButtonOnly): data() caches and emits the `plan` frame;
// Preview reads the current tasks to mark unchanged rows; Run sends the rest.

export type WriteTasksStatus = "idle" | "previewing" | "writing" | "ok" | "error";

export class WriteTasksNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    tasks: "Wiring rows never writes a task. The write runs only from the Run button, and the node loads disarmed. A row with a path updates that task; a row without one creates a task from its title.",
    plan: "One row per input row: path, title, the action (create, update, unchanged, skip) and the fields that will be sent. Preview fills in unchanged by reading the current tasks.",
  };
  label: string;
  /** Columns to send, comma-separated; "" = every writable column present. */
  stringLiterals: Record<string, string> = { keys: "" };
  /** Never persisted (sink.ts) — always false on a fresh construction. */
  enabled = false;
  cachedCube: CubeValue | SolError | null = null;
  cachedPlan: FrameValue | SolError | null = null;
  /** Per-row resolution from Preview (index → action), cleared when the input changes. */
  private resolved = new Map<number, string>();
  private planRows: TaskWritePlanRow[] = [];
  status: WriteTasksStatus = "idle";
  statusMessage = "";
  width = 262; height = 250;

  /** The plan frame's columns are fixed (declareOnce). */
  frameShape(): Shape {
    return { columns: [
      { name: "path", type: "string" }, { name: "title", type: "string" },
      { name: "action", type: "string" }, { name: "fields", type: "string" },
    ] };
  }

  constructor(init?: { label?: string }) {
    super("WriteTasks");
    this.label = init?.label ?? "Write Tasks";
    this.addInput("tasks", cubeIn("Rows"));
    this.addOutput("plan", frameOutPort("Plan"));
  }

  private keys(): string[] {
    return (this.stringLiterals.keys ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  }

  // Caches only — never touches the network.
  data(inputs: { tasks?: (CubeValue | SolError | null)[] }): { plan: FrameValue | SolError | null } {
    const raw = inputs.tasks?.[0] ?? null;
    if (raw !== this.cachedCube) this.resolved = new Map();
    this.cachedCube = raw;
    if (isSolError(raw)) { this.cachedPlan = raw; this.planRows = []; return { plan: raw }; }
    if (!isCubeValue(raw)) { this.cachedPlan = null; this.planRows = []; return { plan: null }; }
    this.planRows = planTaskWrites(raw, this.keys());
    this.cachedPlan = taskPlanFrame(this.planRows, this.resolved);
    return { plan: this.cachedPlan };
  }

  private apiUrl(): string { return settingsStore.get("taskNotesUrl"); }
  private headers(): Record<string, string> { return authHeaders(apiKeyStore.get(TASKNOTES_KEY_ID)); }

  /** Read every update row's current task and mark the ones the payload wouldn't change. */
  async preview(): Promise<void> {
    if (this.status === "previewing" || this.status === "writing") return;
    if (!this.planRows.length) { this.status = "error"; this.statusMessage = "Nothing to write. Connect rows."; return; }
    this.status = "previewing";
    try {
      const resolved = new Map<number, string>();
      let unchanged = 0, unreadable = 0;
      for (let i = 0; i < this.planRows.length; i++) {
        const r = this.planRows[i];
        if (r.action !== "update") continue;
        try {
          const { text } = await fetchText(taskUrl(this.apiUrl(), r.path), { headers: this.headers() });
          const current = taskRecord((unwrap(text) ?? {}) as Record<string, unknown>);
          const same = Object.entries(r.payload).every(([k, v]) => JSON.stringify(v) === JSON.stringify(currentField(current, k)));
          if (same) { resolved.set(i, "unchanged"); unchanged++; }
        } catch {
          resolved.set(i, "unreadable"); unreadable++;
        }
      }
      this.resolved = resolved;
      this.cachedPlan = taskPlanFrame(this.planRows, this.resolved);
      const creates = this.planRows.filter((r) => r.action === "create").length;
      const updates = this.planRows.filter((r, i) => r.action === "update" && !resolved.has(i)).length;
      this.status = "idle";
      this.statusMessage = `Preview: ${creates} to create, ${updates} to update, ${unchanged} unchanged${unreadable ? `, ${unreadable} unreadable` : ""}`;
    } catch (e) {
      this.status = "error";
      this.statusMessage = e instanceof Error ? e.message : String(e);
    }
  }

  /** Call ONLY from the node's Run button; re-entrancy-guarded. */
  async run(): Promise<void> {
    if (this.status === "writing" || this.status === "previewing") return;
    if (!this.enabled) { this.status = "error"; this.statusMessage = "Disabled. Arm it first."; return; }
    if (isSolError(this.cachedCube)) { this.status = "error"; this.statusMessage = this.cachedCube.code; return; }
    if (!this.planRows.length) { this.status = "error"; this.statusMessage = "Nothing to write. Connect rows."; return; }
    this.status = "writing";
    let created = 0, updated = 0, failed = 0;
    const failures: string[] = [];
    try {
      for (let i = 0; i < this.planRows.length; i++) {
        const r = this.planRows[i];
        const state = this.resolved.get(i);
        if (r.action === "skip" || state === "unchanged" || state === "unreadable") continue;
        try {
          if (r.action === "create") {
            await fetchJson(createTaskUrl(this.apiUrl()), { method: "POST", headers: this.headers(), body: r.payload });
            created++;
          } else {
            await fetchJson(taskUrl(this.apiUrl(), r.path), { method: "PUT", headers: this.headers(), body: r.payload });
            updated++;
          }
        } catch (e) {
          failed++;
          if (failures.length < 3) failures.push(`${r.title || r.path}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      this.status = failed ? "error" : "ok";
      this.statusMessage = `${created} created, ${updated} updated${failed ? `, ${failed} failed — ${failures.join("; ")}` : ""}`;
    } catch (e) {
      this.status = "error";
      this.statusMessage = e instanceof Error ? e.message : String(e);
    }
  }
}

/** The current task's value for a writable key, in the same JSON shape a payload uses. */
function currentField(t: TaskRecord, key: string): unknown {
  switch (key) {
    case "title": return t.title;
    case "status": return t.status ?? undefined;
    case "priority": return t.priority ?? undefined;
    case "due": return cellToTaskField("due", t.due);
    case "scheduled": return cellToTaskField("scheduled", t.scheduled);
    case "tags": return t.tags;
    case "contexts": return t.contexts;
    case "projects": return t.projects;
    case "timeEstimate": return t.timeEstimate ?? undefined;
    case "blockedBy": return cellToTaskField("blockedBy", t.blockedBy);
    default: return t.user[key];
  }
}
