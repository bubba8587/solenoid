// [[C69]] ganttPackages, [[C100]] chartIsAValue, [[C96]] chartOptionsAreMatplotlib, [[C44]] dateSerials, [[D66]] daysMinutesModes

export type LinkType = "FS" | "SS" | "FF" | "SF";

export interface GanttTask {
  id: string;
  name: string;
  level: number;
  summary: boolean;
  milestone: boolean;
  start: number;
  finish: number;
  duration?: number;
  segments?: Array<[number, number]>;
  complete: number;
  critical: boolean;
  late: boolean;
  violated: boolean;
  float: number | null;
  floored?: boolean;
  manual?: boolean;
  deadline?: number;
  baselineStart?: number;
  baselineFinish?: number;
  group?: string;
  color?: string;
  resource?: string;
  units?: number;
}

export interface GanttLink {
  from: string;
  to: string;
  type: LinkType;
  lag: number;
  critical: boolean;
  violated: boolean;
}

export interface GanttViewOptions {
  layout?: "gantt" | "calendar";
  zoom?: "day" | "week" | "month" | "quarter" | "year" | "fit";
  tiers?: 1 | 2;
  window?: [number, number];
  collapse?: number;
  critical?: boolean;
  baseline?: boolean;
  arrows?: boolean;
  today?: boolean;
  status?: boolean;
  weekends?: boolean;
  group_by?: boolean;
  labels?: boolean;
  week?: "iso" | "us";
  fiscal_start?: number;
  minutes?: boolean;
  histogram?: boolean;
  fit?: "page";
  columns?: Array<"name" | "start" | "finish" | "duration" | "float" | "complete" | "predecessors">;
}

export interface GanttPayload {
  kind: "gantt";
  tasks: GanttTask[];
  links: GanttLink[];
  nonWorking: Array<[number, number]>;
  weekend: number[];
  holidays: number[];
  today: number | null;
  statusDate: number | null;
  projectStart: number;
  projectFinish: number;
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

export function parseGanttViewOptions(input: string | null | undefined, parseDate?: (s: string) => number | null): GanttViewOptions {
  const v: GanttViewOptions = {};
  if (!input) return v;
  for (const part of input.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    switch (key) {
      case "layout": { const l = val.toLowerCase(); if (l === "gantt" || l === "calendar") v.layout = l; break; }
      case "fit": { if (val.toLowerCase() === "page") v.fit = "page"; break; }
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
      case "critical": case "baseline": case "arrows": case "today": case "status": case "weekends": case "group_by": case "labels": case "minutes": case "histogram": {
        const b = toBool(val);
        if (b !== undefined) v[key] = b;
        break;
      }
      default: break;
    }
  }
  return v;
}
