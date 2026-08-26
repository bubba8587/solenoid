// Human-readable session history: one line per labeled record under a date
// header. Labels come from the snapshot diff (flow/flowHistoryDigest.ts); the
// rete-history action describer died with the rete surface (git has it).

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** One line per already-labeled record under a date header; records can span
 *  days, since the stack clears only on document load. */
export function digestLabeled(records: Array<{ time: number; label: string }>): string {
  if (records.length === 0) return "No actions yet this session.";
  const lines: string[] = [];
  let lastDate = "";
  for (const r of records) {
    const d = fmtDate(r.time);
    if (d !== lastDate) {
      lines.push(`— ${d} —`);
      lastDate = d;
    }
    lines.push(`${fmtTime(r.time)}  ${r.label}`);
  }
  return lines.join("\n");
}
