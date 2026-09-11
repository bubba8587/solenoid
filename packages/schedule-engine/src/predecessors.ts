// The predecessor grammar `<row><type><±lag><unit>` (`3FS+2d, 5SS-1d`, Smartsheet /
// Project) lives ONLY at the import border: row numbers resolve to names here and never
// become an internal key. Also the inverse, for the grid's Predecessors column.

import type { LinkType, PlanDependency } from "./types";
import { LINK_TYPES } from "./graph";

const TOKEN = /^\s*(\d+|[^,;]+?)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+(?:\.\d+)?)?\s*(e?d|w|wk|h)?\s*$/i;

/** Parse one predecessor cell. `names` is the 1-based row → task name map; a token that is
 *  not a row number is taken as a task name (so a hand-typed name list works too). */
export function parsePredecessorText(text: string, names: readonly string[]): { deps: PlanDependency[]; errors: string[] } {
  const deps: PlanDependency[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/[,;]/)) {
    if (!raw.trim()) continue;
    const m = TOKEN.exec(raw);
    if (!m) { errors.push(raw.trim()); continue; }
    const [, ref, typeRaw, lagRaw, unitRaw] = m;
    let task: string;
    if (/^\d+$/.test(ref)) {
      const row = Number(ref);
      const name = names[row - 1];
      if (!name) { errors.push(raw.trim()); continue; }
      task = name;
    } else task = ref.trim();
    const type = (typeRaw ?? "FS").toUpperCase() as LinkType;
    let lag = lagRaw ? Number(lagRaw.replace(/\s+/g, "")) : 0;
    const unit = (unitRaw ?? "d").toLowerCase();
    if (unit === "w" || unit === "wk") lag *= 5;
    else if (unit === "h") lag /= 8;
    deps.push({ task, type: LINK_TYPES.includes(type) ? type : "FS", lag: Math.round(lag) });
  }
  return { deps, errors };
}

/** The grid's text for a task's dependencies: names, with type and lag only when they
 *  differ from the FS/0 default ("Demolition, Framing SS+2"). */
export function predecessorText(deps: readonly PlanDependency[]): string {
  return deps.map((d) => {
    const type = d.type === "FS" ? "" : ` ${d.type}`;
    const lag = d.lag === 0 ? "" : `${type ? "" : " FS"}${d.lag > 0 ? "+" : ""}${d.lag}`;
    return `${d.task}${type}${lag}`;
  }).join(", ");
}
