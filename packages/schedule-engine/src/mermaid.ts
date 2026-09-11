// Mermaid `gantt` source: the interim figure and the Obsidian path (Obsidian renders it
// natively). Exact dates per bar (never `after`, which cannot carry a lag or a type);
// `excludes` lists weekends and the holidays inside the span; one `section` per group.

import type { ScheduleOutput } from "./types";

/** Mermaid gantt escaping: a task name is a label, so the syntax characters go. */
function label(s: string): string {
  return s.replace(/[:#;,]/g, " ").replace(/\s+/g, " ").trim() || "task";
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function mermaidGantt(out: ScheduleOutput, formatIso: (serial: number) => string): string {
  const lines = ["gantt", "    dateFormat YYYY-MM-DD", "    axisFormat %d %b"];
  if (out.weekend.length) {
    const std = out.weekend.length === 2 && out.weekend.includes(0) && out.weekend.includes(6);
    const days = std ? ["weekends"] : out.weekend.map((d) => WEEKDAY_NAMES[d]);
    lines.push(`    excludes ${[...days, ...out.holidays.map(formatIso)].join(", ")}`);
  }
  const sections = new Map<string | null, number[]>();
  out.tasks.forEach((t, i) => {
    const k = t.group;
    if (!sections.has(k)) sections.set(k, []);
    sections.get(k)!.push(i);
  });
  for (const [group, idxs] of sections) {
    if (group !== null) lines.push(`    section ${label(group)}`);
    for (const i of idxs) {
      const t = out.tasks[i];
      if (t.summary) continue; // a bracket has no Mermaid form; its children draw
      const tags = [
        t.milestone ? "milestone" : "",
        t.complete >= 100 ? "done" : t.complete > 0 ? "active" : "",
        t.critical ? "crit" : "",
      ].filter(Boolean);
      const startIso = formatIso(t.start);
      // Mermaid's end is exclusive, so a bar runs to the day after Finish.
      const span = t.milestone ? "0d" : formatIso(t.finish + 1);
      const indent = "  ".repeat(t.level);
      lines.push(`    ${indent}${label(t.name)} :${tags.length ? tags.join(", ") + ", " : ""}t${i}, ${startIso}, ${span}`);
    }
  }
  return lines.join("\n");
}
