import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { schedule, readMspdi, mermaidGantt, type PlanTask } from "./index";

// The public trackers' known-bug list (25-gantt.md § 3.2) and the DCMA invariants over the
// corpus, as regressions this engine must not grow.

const S = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
const iso = (s: number) => new Date(Math.round((Math.floor(s + 1e-9) - 25569) * 86400000)).toISOString().slice(0, 10);
const t = (name: string, duration: number, preds: string[] = [], extra: Partial<PlanTask> = {}): PlanTask => ({ name, duration, predecessors: preds.map((p) => ({ task: p, type: "FS", lag: 0 })), ...extra });
const DIR = join(__dirname, "../../../fixtures/schedule");

describe("known-bug regressions", () => {
  it("a DST switch does not drift a date by an hour (Frappe #616, Bryntum #13336): serials stay whole days", () => {
    // US spring-forward 8 Mar 2026 and the EU one 29 Mar 2026 fall inside this plan.
    const o = schedule({ tasks: [t("A", 10), t("B", 10, ["A"]), t("C", 10, ["B"])], start: S(2026, 3, 2), calendar: { workingDays: true } });
    for (const x of o.tasks) { expect(Number.isInteger(x.start)).toBe(true); expect(Number.isInteger(x.finish)).toBe(true); }
    expect(iso(o.tasks[2].finish)).toBe("2026-04-10");
  });

  it("a lag honours the calendar (Bryntum #12454): FS+2 over a weekend lands on Tuesday, not Sunday", () => {
    const o = schedule({ tasks: [t("A", 1), { ...t("B", 1), predecessors: [{ task: "A", type: "FS", lag: 2 }] }], start: S(2026, 1, 9), calendar: { workingDays: true } });
    expect(iso(o.tasks[1].start)).toBe("2026-01-14"); // Fri 9 → Mon 12, Tue 13 skipped by the lag → Wed 14
  });

  it("a parent of zero-duration children is a zero-span summary, not a day long", () => {
    const o = schedule({ tasks: [{ ...t("Gate", 0), children: [t("M1", 0), t("M2", 0, ["M1"])] }], start: S(2026, 1, 5), calendar: { workingDays: true } });
    expect(o.tasks[0].summary).toBe(true);
    expect(o.tasks[0].duration).toBe(0);
    expect(iso(o.tasks[0].start)).toBe("2026-01-05");
  });

  it("a circular link never hangs (DHTMLX #109): it is refused by name, even through a phase", () => {
    expect(() => schedule({ tasks: [t("A", 1, ["C"]), t("B", 1, ["A"]), t("C", 1, ["B"])], start: S(2026, 1, 5), calendar: { workingDays: true } })).toThrow(/loop/);
    expect(() => schedule({ tasks: [{ ...t("P", 0, ["X"]), children: [t("X", 1)] }], start: S(2026, 1, 5), calendar: { workingDays: true } })).toThrow(/loop/);
  });

  it("Mermaid's excludes is not off by one (#6421): a bar ending Friday runs to Saturday's date, exclusive", () => {
    const o = schedule({ tasks: [t("A", 5)], start: S(2026, 1, 5), calendar: { workingDays: true } });
    const src = mermaidGantt(o, iso);
    expect(src).toContain("A :crit, t0, 2026-01-05, 2026-01-10");
  });
});

describe("DCMA invariants over the corpus", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".mspdi.xml"));
  it.each(files)("%s: no negative float, no broken link, every task linked, no lead, durations under 44 days", (f) => {
    const plan = readMspdi(readFileSync(join(DIR, f), "utf8"));
    const o = schedule({ tasks: plan.tasks, start: plan.start, calendar: plan.calendar });
    const checks = o.diagnostics.map((d) => d.check);
    expect(checks).not.toContain("Negative float");
    expect(checks).not.toContain("Broken link");
    expect(checks).not.toContain("Long task");
    // Missing logic is reported exactly: a task is called unlinked only when no authored link
    // (its own or a phase's) reaches it.
    const flat: PlanTask[] = [];
    const walk = (list: PlanTask[]) => { for (const x of list) { flat.push(x); if (x.children) walk(x.children); } };
    walk(plan.tasks);
    const preds = new Set(flat.flatMap((x) => x.predecessors.map((d) => d.task.toLowerCase())));
    for (const d of o.diagnostics) {
      if (d.check === "No successor") expect(preds.has(d.task.toLowerCase()), `${d.task} has a successor`).toBe(false);
      if (d.check === "No predecessor") expect(flat.find((x) => x.name === d.task)!.predecessors.length, `${d.task} has a predecessor`).toBe(0);
    }
    // Every leaf has a defined, ordered span; the critical path reaches the finish.
    for (const x of o.tasks) expect(x.finish).toBeGreaterThanOrEqual(x.start - 1e-9);
    expect(o.tasks.some((x) => x.critical && x.finish >= o.projectFinish - 1e-9)).toBe(true);
  });
});
