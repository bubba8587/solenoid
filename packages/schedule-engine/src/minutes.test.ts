import { describe, it, expect } from "vitest";
import { schedule, Calendar, intervalsForHours, type PlanTask } from "./index";

const S = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
const MON = S(2026, 1, 5);
const stamp = (s: number) => {
  const d = new Date(Math.round((s - 25569) * 86400000));
  return d.toISOString().slice(0, 16).replace("T", " ");
};
const t = (name: string, duration: number, preds: (string | [string, "FS" | "SS" | "FF" | "SF", number])[] = [], extra: Partial<PlanTask> = {}): PlanTask => ({
  name, duration,
  predecessors: preds.map((p) => (typeof p === "string" ? { task: p, type: "FS", lag: 0 } : { task: p[0], type: p[1], lag: p[2] })),
  ...extra,
});
const run = (tasks: PlanTask[], over: Partial<Parameters<typeof schedule>[0]> = {}) =>
  schedule({ tasks, start: MON, calendar: { workingDays: true, precision: "minutes" }, ...over });
const by = (o: ReturnType<typeof schedule>, name: string) => o.tasks.find((x) => x.name === name)!;

describe("Calendar in Minutes mode", () => {
  it("maps working minutes through the 08:00–12:00 / 13:00–17:00 day and back", () => {
    const c = new Calendar(MON, { workingDays: true, precision: "minutes" });
    expect(c.unitsPerDay).toBe(480);
    expect(stamp(c.date(0))).toBe("2026-01-05 08:00");
    expect(stamp(c.date(239))).toBe("2026-01-05 11:59");
    expect(stamp(c.date(240))).toBe("2026-01-05 13:00");
    expect(stamp(c.dateEnd(479))).toBe("2026-01-05 17:00");
    expect(stamp(c.date(480))).toBe("2026-01-06 08:00");
    expect(c.indexCeil(MON)).toBe(0);                          // a date-only serial starts the day
    expect(c.indexCeil(MON + 12.5 / 24)).toBe(240);            // 12:30 is lunch → 13:00
    expect(c.indexCeil(MON + 17 / 24)).toBe(480);              // 17:00 is over → next morning
    expect(c.indexFloor(MON)).toBe(479);                       // a date-only ceiling means the end of that day
    expect(c.indexFloor(MON + 17 / 24)).toBe(479);
    expect(c.indexFloor(MON + 12.5 / 24)).toBe(239);
    expect(c.indexCeil(S(2026, 1, 10))).toBe(5 * 480);         // Saturday → Monday 08:00 (day index 5)
    expect(intervalsForHours(8)).toEqual([[480, 720], [780, 1020]]);
    expect(intervalsForHours(6)).toEqual([[480, 720], [780, 900]]);
    expect(intervalsForHours(10)).toEqual([[480, 1080]]);
    expect(new Calendar(MON, { workingDays: true, precision: "minutes", intervals: [[540, 780]] }).unitsPerDay).toBe(240);
  });
});

describe("schedule in Minutes mode", () => {
  it("an FS successor starts the same afternoon; a finish is 17:00; fractional days are minutes", () => {
    const o = run([t("A", 0.5), t("B", 1, ["A"]), t("C", 0.25, ["B"])]);
    expect(stamp(by(o, "A").start)).toBe("2026-01-05 08:00");
    expect(stamp(by(o, "A").finish)).toBe("2026-01-05 12:00");
    expect(stamp(by(o, "B").start)).toBe("2026-01-05 13:00");
    expect(stamp(by(o, "B").finish)).toBe("2026-01-06 12:00");
    expect(stamp(by(o, "C").start)).toBe("2026-01-06 13:00");
    expect(stamp(by(o, "C").finish)).toBe("2026-01-06 15:00");
    expect(o.tasks.map((x) => x.float)).toEqual([0, 0, 0]);
  });

  it("whole-day tasks agree with Days mode on the day; a milestone sits at 17:00; float is in days", () => {
    const tasks = [t("A", 2), t("B", 3, ["A"]), t("C", 1, ["A"]), t("M", 0, ["B", "C"])];
    const m = run(tasks);
    const d = schedule({ tasks, start: MON, calendar: { workingDays: true } });
    for (const x of d.tasks) {
      const y = by(m, x.name);
      expect(Math.floor(y.start)).toBe(x.start);
      expect(Math.floor(y.finish - 1e-9)).toBe(x.finish);
      expect(y.float).toBe(x.float);
      expect(y.critical).toBe(x.critical);
    }
    expect(stamp(by(m, "M").start)).toBe("2026-01-09 17:00");
    expect(by(m, "C").float).toBe(2);
  });

  it("a lag of half a day; a deadline at a clock time; the status date at day end", () => {
    const o = run([t("A", 1), t("B", 1, [["A", "FS", 0.5]], { deadline: MON + 1 + 15 / 24 })]);
    expect(stamp(by(o, "B").start)).toBe("2026-01-06 13:00");
    expect(stamp(by(o, "B").finish)).toBe("2026-01-07 12:00");
    expect(by(o, "B").late).toBe(true);
    expect(by(o, "B").float).toBe(-0.75); // Tue 15:00→17:00 + Wed 08:00→12:00
    const s = run([t("A", 2, [], { complete: 50 })], { statusDate: S(2026, 1, 6) });
    expect(stamp(by(s, "A").finish)).toBe("2026-01-07 17:00"); // half done by end of Tue → the rest on Wed
  });
});
