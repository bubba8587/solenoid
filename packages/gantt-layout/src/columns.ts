// The tree-grid columns for the left pane, derived from view.columns (default: name, start,
// finish, duration). Widths are suggestions the view may override; the name column is the
// flexible one.

import type { GanttPayload } from "./payload";
import type { GridColumn } from "./frame";

// Dates are fixed-width (DD-MMM-YYYY, ~11 mono chars); their columns are exactly that wide.
const DEFAULTS: GridColumn[] = [
  { key: "name", label: "Task", width: 190, align: "left" },
  { key: "start", label: "Start", width: 86, align: "left" },
  { key: "finish", label: "Finish", width: 86, align: "left" },
  { key: "duration", label: "Days", width: 50, align: "right" },
  { key: "float", label: "Float", width: 50, align: "right" },
  { key: "complete", label: "%", width: 42, align: "right" },
  { key: "predecessors", label: "Predecessors", width: 150, align: "left" },
];

export function buildColumns(payload: GanttPayload): GridColumn[] {
  const want = payload.view.columns ?? ["name", "start", "finish", "duration"];
  const byKey = new Map(DEFAULTS.map((c) => [c.key, c]));
  const cols: GridColumn[] = [];
  for (const key of want) {
    const c = byKey.get(key);
    if (c && !cols.some((x) => x.key === key)) cols.push({ ...c });
  }
  // Name is mandatory and leads.
  if (!cols.some((c) => c.key === "name")) cols.unshift({ ...DEFAULTS[0] });
  return cols;
}
