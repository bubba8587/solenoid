// [[C69]] ganttPackages, [[C44]] dateSerials, [[D65]] serialsNeverDate
// Grid-cell text for a task under a column key; dates as DD-MMM-YYYY via serial math.

import type { GanttPayload, GanttTask } from "./payload";
import type { GridColumn } from "./frame";
import { civilFromSerial, MONTH_NAMES } from "./serial";
import { drawnLastDay } from "./scale";

/** Format a whole-day serial as DD-MMM-YYYY ([[C44]] dateSerials). */
export function formatDate(serial: number): string {
  if (!Number.isFinite(serial)) return "";
  const c = civilFromSerial(serial);
  const dd = String(c.day).padStart(2, "0");
  return `${dd}-${MONTH_NAMES[c.month - 1]}-${c.year}`;
}

export function formatCell(key: GridColumn["key"], t: GanttTask, payload: GanttPayload): string {
  switch (key) {
    case "name":
      return t.name;
    case "start":
      return formatDate(t.start);
    case "finish":
      // The displayed Finish day (Minutes mode moves a midnight finish to the previous day).
      return t.milestone ? formatDate(t.start) : formatDate(drawnLastDay(t.finish, payload.view.minutes));
    case "duration":
      // Working days (Schedule's Duration / a summary's rolled-up span) when the payload
      // carries it; the inclusive calendar span is only the fallback.
      if (t.milestone) return "0";
      if (t.duration != null) return String(t.duration);
      return String(Math.max(1, drawnLastDay(t.finish, payload.view.minutes) - Math.floor(t.start) + 1));
    case "float":
      return t.float == null ? "" : String(t.float);
    case "complete":
      return t.complete ? `${Math.round(t.complete)}%` : "";
    case "predecessors":
      return payload.predecessorText?.[t.id] ?? "";
    default:
      return "";
  }
}
