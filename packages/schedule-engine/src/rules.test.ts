import { describe, it, expect } from "vitest";
import { schedule, type PlanTask } from "./index";

// Rules 1, 5 (elapsed), 7 (deadline moves ALAP), 10 (ALAP), 13 (actual start, split
// remainder) of 25-gantt.md § 3.1, and per-task calendars.

const S = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
const MON = S(2026, 1, 5);
const iso = (s: number) => new Date(Math.round((s - 25569) * 86400000)).toISOString().slice(0, 10);
const stamp = (s: number) => new Date(Math.round((s - 25569) * 86400000)).toISOString().slice(0, 16).replace("T", " ");
const t = (name: string, duration: number, preds: (string | [string, "FS" | "SS" | "FF" | "SF", number])[] = [], extra: Partial<PlanTask> = {}): PlanTask => ({
  name, duration,
  predecessors: preds.map((p) => (typeof p === "string" ? { task: p, type: "FS", lag: 0 } : { task: p[0], type: p[1], lag: p[2] })),
  ...extra,
});
const run = (tasks: PlanTask[], over: Partial<Parameters<typeof schedule>[0]> = {}) =>
  schedule({ tasks, start: MON, calendar: { workingDays: true }, ...over });
const by = (o: ReturnType<typeof schedule>, name: string) => o.tasks.find((x) => x.name === name)!;

describe("per-task calendars (rule 1) and elapsed time (rule 5)", () => {
  it("a task on a Sunday-to-Thursday week runs through Friday's skip differently; links cross calendars by instant", () => {
    // A works Mon–Fri; B works Sun–Thu (weekend code 7 = Fri + Sat off).
    const o = run([t("A", 4), t("B", 2, ["A"], { calendar: { weekendCode: 7 } })]);
    expect(iso(by(o, "A").finish)).toBe("2026-01-08");   // Mon..Thu
    expect(iso(by(o, "B").start)).toBe("2026-01-11");    // Fri is B's weekend → Sunday
    expect(iso(by(o, "B").finish)).toBe("2026-01-12");
    expect(o.tasks.map((x) => x.float)).toEqual([1, 0]); // A could run into Friday; B still starts Sunday
  });

  it("a task with its own holiday skips it; the project calendar does not", () => {
    const o = run([t("A", 3, [], { calendar: { holidays: [S(2026, 1, 6)] } }), t("B", 3)]);
    expect(iso(by(o, "A").finish)).toBe("2026-01-08");
    expect(iso(by(o, "B").finish)).toBe("2026-01-07");
  });

  it("an elapsed duration counts every day; an elapsed lag counts calendar days", () => {
    const o = run([t("Cure", 3, [], { elapsed: true }), t("A", 1, ["Cure"]), t("B", 1, [], { predecessors: [{ task: "A", type: "FS", lag: 2, elapsed: true }] })], { start: S(2026, 1, 9) }); // Fri
    expect(iso(by(o, "Cure").start)).toBe("2026-01-09");
    expect(iso(by(o, "Cure").finish)).toBe("2026-01-11");  // Fri Sat Sun
    expect(iso(by(o, "A").start)).toBe("2026-01-12");      // Monday
    expect(iso(by(o, "B").start)).toBe("2026-01-15");      // A is over Tue 13 00:00; + 2 calendar days → Thu 15
  });

  it("per-task hours in Minutes mode: a 4-hour day finishes a 1-day task at noon", () => {
    const o = run([t("Short", 1, [], { calendar: { intervals: [[480, 720]] } }), t("Next", 0.5, ["Short"])], { calendar: { workingDays: true, precision: "minutes" } });
    expect(stamp(by(o, "Short").finish)).toBe("2026-01-05 12:00");
    expect(stamp(by(o, "Next").start)).toBe("2026-01-05 13:00");
    expect(stamp(by(o, "Next").finish)).toBe("2026-01-05 17:00"); // 240 project minutes from 13:00
  });
});

describe("ALAP (rules 7, 10)", () => {
  it("an ALAP task starts at its late start, is critical, and a deadline pulls it earlier", () => {
    const o = run([t("A", 5), t("Order", 1, [], { alap: true }), t("Install", 1, ["A", "Order"])]);
    expect(iso(by(o, "Order").start)).toBe("2026-01-09"); // the day before Install
    expect(by(o, "Order").critical).toBe(true);
    expect(by(o, "Order").alap).toBe(true);
    const d = run([t("A", 5), t("Order", 1, [], { alap: true, deadline: S(2026, 1, 7) }), t("Install", 1, ["A", "Order"])]);
    expect(iso(by(d, "Order").start)).toBe("2026-01-07");
    expect(by(d, "Order").late).toBe(false);
    // Without ALAP the same task sits at the project start.
    const asap = run([t("A", 5), t("Order", 1), t("Install", 1, ["A", "Order"])]);
    expect(iso(by(asap, "Order").start)).toBe("2026-01-05");
    expect(by(asap, "Order").critical).toBe(false);
  });
});

describe("longest path (P6) and effort-driven durations (rule 16)", () => {
  it("longest path: the driving chain to the finish is critical even when a floor gives it float", () => {
    // B is held by a typed Start so it has float against C's chain, but it still DRIVES the finish.
    const tasks = [t("A", 1), t("B", 2, ["A"], { start: S(2026, 1, 12) }), t("C", 3), t("End", 0, ["B", "C"])];
    const byFloat = run(tasks);
    const byPath = run(tasks, { longestPath: true });
    expect(byFloat.tasks.map((x) => x.critical)).toEqual([false, true, false, true]);
    expect(byPath.tasks.map((x) => x.critical)).toEqual([false, true, false, true]);
    // A drives nothing (B's floor won) → not on the longest path either way; the float rule and
    // the path rule differ when a task with float lies on the driving chain:
    const gap = [t("A", 1), t("B", 1, ["A"], { deadline: S(2026, 1, 30) }), t("C", 5)];
    expect(run(gap).tasks.map((x) => x.critical)).toEqual([false, false, true]);
    expect(run(gap, { longestPath: true }).tasks.map((x) => x.critical)).toEqual([false, false, true]);
  });

  it("work over units gives the duration when none is typed", () => {
    const o = run([t("A", 0, [], { duration: undefined as never, work: 40, units: 1 }), t("B", 0, [], { duration: undefined as never, work: 40, units: 2 })]);
    expect(by(o, "A").duration).toBe(5);
    expect(by(o, "B").duration).toBe(2.5);
    expect(iso(by(o, "B").finish)).toBe("2026-01-07"); // 2.5 days rounds up to 3 whole days
  });
});

describe("progress (rule 13)", () => {
  it("splits a started task around the status date, keeping the done part where it was", () => {
    const o = run([t("A", 4, [], { complete: 50 }), t("B", 1, ["A"])], { statusDate: S(2026, 1, 8) });
    const a = by(o, "A");
    expect(iso(a.start)).toBe("2026-01-05");
    expect(iso(a.finish)).toBe("2026-01-12");
    expect(a.segments?.map(([s, f]) => [iso(s), iso(f)])).toEqual([["2026-01-05", "2026-01-06"], ["2026-01-09", "2026-01-12"]]);
    expect(iso(by(o, "B").start)).toBe("2026-01-13");
    // The contiguous alternative (Project's option off): the whole bar moves.
    const c = run([t("A", 4, [], { complete: 50 }), t("B", 1, ["A"])], { statusDate: S(2026, 1, 8), splitInProgress: false });
    expect(by(c, "A").segments).toBeUndefined();
    expect(iso(by(c, "A").start)).toBe("2026-01-07");
    expect(iso(by(c, "A").finish)).toBe("2026-01-12");
  });

  it("an actual start pins the early start even before a predecessor allows (out-of-sequence)", () => {
    const o = run([t("A", 3), t("B", 2, ["A"], { actualStart: S(2026, 1, 6), complete: 50 })], { statusDate: S(2026, 1, 6) });
    expect(iso(by(o, "B").start)).toBe("2026-01-06");
    expect(o.links[0].violated).toBe(true);
    expect(iso(by(o, "B").finish)).toBe("2026-01-07");
  });

  it("a task that is not started and a finished task are unchanged by the status date", () => {
    const o = run([t("A", 2, [], { complete: 100 }), t("B", 2, ["A"])], { statusDate: S(2026, 1, 20) });
    expect(iso(by(o, "A").finish)).toBe("2026-01-06");
    expect(by(o, "A").segments).toBeUndefined();
    expect(iso(by(o, "B").start)).toBe("2026-01-07");
  });
});
