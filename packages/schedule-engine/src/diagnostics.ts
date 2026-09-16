// The DCMA 14-point checks that make sense for a table of tasks, under plain names, one
// row per finding. No acronyms on the user's screen.

import type { Diagnostic, ScheduleLink, ScheduledTask } from "./types";

const HIGH_FLOAT_DAYS = 44;

export function diagnose(
  tasks: ScheduledTask[], links: ScheduleLink[],
  opts: { statusDate: number | null; longTask: number },
): Diagnostic[] {
  const out: Diagnostic[] = [];
  // A link on a phase counts for every task beneath it (rule 12), so a leaf whose phase
  // waits on something is not "unlinked".
  const withAncestors = (name: string) => {
    const i = tasks.findIndex((t) => t.name === name);
    const names = [name.toLowerCase()];
    for (let j = i - 1, level = tasks[i]?.level ?? 0; j >= 0 && level > 0; j--) {
      if (tasks[j].level < level) { names.push(tasks[j].name.toLowerCase()); level = tasks[j].level; }
    }
    return names;
  };
  const linkedTo = new Set(links.map((l) => l.to.toLowerCase()));
  const linkedFrom = new Set(links.map((l) => l.from.toLowerCase()));
  const hasPred = new Set<string>();
  const hasSucc = new Set<string>();
  for (const t of tasks) {
    const chain = withAncestors(t.name);
    if (chain.some((n) => linkedTo.has(n))) hasPred.add(t.name.toLowerCase());
    if (chain.some((n) => linkedFrom.has(n))) hasSucc.add(t.name.toLowerCase());
  }
  const leaves = tasks.filter((t) => !t.summary);
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  for (const t of leaves) {
    const k = t.name.toLowerCase();
    if (t.manual) out.push({ check: "Manual", task: t.name, detail: "Pinned to its typed dates; its predecessors are ignored" });
    else {
      if (!hasPred.has(k) && leaves.length > 1) out.push({ check: "No predecessor", task: t.name, detail: "Starts on the project start; nothing holds it" });
      if (!hasSucc.has(k) && leaves.length > 1) out.push({ check: "No successor", task: t.name, detail: "Nothing waits on it; a slip moves nothing" });
    }
    if (t.floored) out.push({ check: "Held by a typed start", task: t.name, detail: "Its Start is later than its predecessors need" });
    if (t.float < 0) out.push({ check: "Negative float", task: t.name, detail: `${days(-t.float)} short of its Finish or Deadline` });
    else if (t.float > HIGH_FLOAT_DAYS) out.push({ check: "High float", task: t.name, detail: `${days(t.float)} of slack; check its links` });
    if (t.late) out.push({ check: "Past deadline", task: t.name, detail: "Finishes after its Deadline" });
    if (t.duration > opts.longTask) out.push({ check: "Long task", task: t.name, detail: `${days(t.duration)}; consider splitting it` });
    if (opts.statusDate != null) {
      if (t.complete <= 0 && t.start <= opts.statusDate) out.push({ check: "Should have started", task: t.name, detail: "Starts before the status date with no progress" });
      if (t.complete < 100 && t.finish < opts.statusDate) out.push({ check: "Should have finished", task: t.name, detail: "Finishes before the status date but is not complete" });
      if (t.complete >= 100 && t.finish > opts.statusDate) out.push({ check: "Finished early", task: t.name, detail: "Complete before its scheduled finish" });
    }
  }
  for (const l of links) {
    if (l.lag < 0) out.push({ check: "Lead", task: l.to, detail: `${days(-l.lag)} before ${l.from} ${l.type === "FS" ? "finishes" : "starts"}` });
    else if (l.lag > 0) out.push({ check: "Lag", task: l.to, detail: `${days(l.lag)} after ${l.from}` });
    if (l.type !== "FS") out.push({ check: "Link type", task: l.to, detail: `${l.type} from ${l.from}` });
    if (l.violated) out.push({ check: "Broken link", task: l.to, detail: `Starts before ${l.from} allows` });
  }
  return out;
}
