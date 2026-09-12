// The Gantt figure's INPUT contract: data, never geometry. Every number is an Excel date
// serial (a whole day; the figure adds one day when it draws a bar so an inclusive Finish
// fills its last day). The engine (`@solenoid/schedule-engine`) and the app's Gantt node
// build this; `layoutGantt` in this package turns it into pixels at a given width.

export type LinkType = "FS" | "SS" | "FF" | "SF";

export interface GanttTask {
  /** The task's unique key (its name, matched trimmed + case-insensitive by the engine). */
  id: string;
  name: string;
  /** Nesting depth from the WBS: 0 = top level. Rows arrive depth-first in row order. */
  level: number;
  /** A parent row (a bracket, dates rolled up from its children). */
  summary: boolean;
  /** Zero-duration task (a diamond on its day). */
  milestone: boolean;
  /** Scheduled start, a whole-day serial. */
  start: number;
  /** Scheduled finish, INCLUSIVE (the last day the task occupies). Equals start on a milestone. */
  finish: number;
  /** Working days (the Schedule's Duration; a summary's rolled-up span). Absent: the grid
   *  falls back to the calendar span. */
  duration?: number;
  /** Out-of-sequence progress splits the bar: inclusive [start, finish] serial pairs, in order,
   *  drawn as segments with a dotted gap between them. Absent: one contiguous bar. The parts
   *  span within [start, finish]; the engine fills this. */
  segments?: Array<[number, number]>;
  /** 0..100; drawn as bar fill. */
  complete: number;
  critical: boolean;
  /** Finish is past the Deadline. */
  late: boolean;
  /** Negative float: a ceiling or deadline the predecessors cannot honor. */
  violated: boolean;
  /** Total float in working days; null on a summary. */
  float: number | null;
  /** A typed Start held this task (a floor that bound). */
  floored?: boolean;
  /** Manual = TRUE pinned the dates. */
  manual?: boolean;
  deadline?: number;
  /** Baseline ghost bar (from a second scheduled frame). */
  baselineStart?: number;
  baselineFinish?: number;
  /** Section label (the Project column). */
  group?: string;
  /** A passthrough color column, any CSS color. */
  color?: string;
}

export interface GanttLink {
  from: string;
  to: string;
  type: LinkType;
  /** Working days; negative = lead. */
  lag: number;
  /** Both ends critical AND this link drove the successor's date. */
  critical: boolean;
  /** The successor starts earlier than this link allows (a floor / manual pin broke it). */
  violated: boolean;
}

/** Persisted view state — the `options` string keys on the Gantt node, resolved. */
export interface GanttViewOptions {
  /** Time-scale preset; `fit` picks whichever fills the width. */
  zoom?: "day" | "week" | "month" | "quarter" | "year" | "fit";
  /** Header tiers: 1 or 2 (the default). */
  tiers?: 1 | 2;
  /** Visible date window [from, to] in serials; absent = the project span padded. */
  window?: [number, number];
  /** Collapse nesting below this level (0 = everything collapsed to top-level rows). */
  collapse?: number;
  /** Highlight the critical path (default on). */
  critical?: boolean;
  /** Draw baseline ghost bars when the payload carries them (default on). */
  baseline?: boolean;
  /** Draw dependency arrows (default on). */
  arrows?: boolean;
  /** Draw the today line (default on). */
  today?: boolean;
  /** Draw the status-date line (default on when a status date exists). */
  status?: boolean;
  /** Shade non-working days (default on). */
  weekends?: boolean;
  /** Group rows under section bands by `GanttTask.group` (default on when groups exist). */
  group_by?: boolean;
  /** Task labels beside bars (default on). */
  labels?: boolean;
  /** Week numbering for the week tier. */
  week?: "iso" | "us";
  /** Fiscal year start month 1..12 for the quarter/year tiers (default 1). */
  fiscal_start?: number;
  /** Grid columns to show, in order. Default: name, start, finish, duration. */
  columns?: Array<"name" | "start" | "finish" | "duration" | "float" | "complete" | "predecessors">;
}

export interface GanttPayload {
  kind: "gantt";
  /** Rows in display order (depth-first over the WBS). */
  tasks: GanttTask[];
  links: GanttLink[];
  /** Non-working day spans [from, to] inclusive, already merged, covering the drawn window. */
  nonWorking: Array<[number, number]>;
  /** Day-of-week numbers that are non-working (0 = Sunday .. 6 = Saturday); [] in calendar mode. */
  weekend: number[];
  /** Holiday serials inside the window. */
  holidays: number[];
  /** Today's serial (the app supplies it; null hides the line). */
  today: number | null;
  /** The status date, when the Schedule node has one. */
  statusDate: number | null;
  projectStart: number;
  projectFinish: number;
  /** Per-task predecessor text for the grid column, e.g. "Demolition, Framing SS+2". */
  predecessorText?: Record<string, string>;
  view: GanttViewOptions;
}

const TRUTHY = new Set(["on", "true", "1", "yes", "y"]);
const FALSY = new Set(["off", "false", "0", "no", "n"]);
function toBool(v: string): boolean | undefined {
  const s = v.trim().toLowerCase();
  return TRUTHY.has(s) ? true : FALSY.has(s) ? false : undefined;
}

const ZOOMS = new Set(["day", "week", "month", "quarter", "year", "fit"]);
const COLUMNS = new Set(["name", "start", "finish", "duration", "float", "complete", "predecessors"]);

/** Parse the Gantt keys out of the shared `key=value;…` options string (unknown keys are
 *  left for `parseChartOptions`; the two parsers read one string). `parseDate` turns a
 *  window bound's text into a serial — injected so this package stays date-format free. */
export function parseGanttViewOptions(input: string | null | undefined, parseDate?: (s: string) => number | null): GanttViewOptions {
  const v: GanttViewOptions = {};
  if (!input) return v;
  for (const part of input.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    switch (key) {
      case "zoom": { const z = val.toLowerCase(); if (ZOOMS.has(z)) v.zoom = z as GanttViewOptions["zoom"]; break; }
      case "tiers": { const n = Number(val); if (n === 1 || n === 2) v.tiers = n; break; }
      case "collapse": { const n = Number(val); if (Number.isInteger(n) && n >= 0) v.collapse = n; break; }
      case "fiscal_start": { const n = Number(val); if (Number.isInteger(n) && n >= 1 && n <= 12) v.fiscal_start = n; break; }
      case "week": { const w = val.toLowerCase(); if (w === "iso" || w === "us") v.week = w; break; }
      case "window": {
        if (!parseDate) break;
        const [a, b] = val.split(",").map((s) => parseDate(s.trim()));
        if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) v.window = a <= b ? [a, b] : [b, a];
        break;
      }
      case "columns": {
        const cols = val.split(",").map((s) => s.trim().toLowerCase()).filter((s) => COLUMNS.has(s));
        if (cols.length) v.columns = cols as GanttViewOptions["columns"];
        break;
      }
      case "critical": case "baseline": case "arrows": case "today": case "status": case "weekends": case "group_by": case "labels": {
        const b = toBool(val);
        if (b !== undefined) v[key] = b;
        break;
      }
      default: break;
    }
  }
  return v;
}
