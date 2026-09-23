// [[C69]] ganttPackages, [[D67]] grammarOnlyAtBorder

import type { LinkType, PlanDependency } from "./types";
import { LINK_TYPES } from "./graph";

const TOKEN = /^\s*(\d+|[^,;]+?)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+(?:\.\d+)?)?\s*(e?d|w|wk|h)?\s*$/i;

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
    deps.push({ task, type: LINK_TYPES.includes(type) ? type : "FS", lag: Math.round(lag * 1000) / 1000, ...(unit === "ed" ? { elapsed: true } : {}) });
  }
  return { deps, errors };
}

export function predecessorText(deps: readonly PlanDependency[]): string {
  return deps.map((d) => {
    const type = d.type === "FS" ? "" : ` ${d.type}`;
    const lag = d.lag === 0 ? "" : `${type ? "" : " FS"}${d.lag > 0 ? "+" : ""}${d.lag}`;
    return `${d.task}${type}${lag}`;
  }).join(", ");
}
