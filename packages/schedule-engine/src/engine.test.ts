import { describe, it, expect } from "vitest";
import { schedule, Calendar, dayOfWeek, parsePredecessorText, predecessorText, mermaidGantt, ScheduleError, type PlanTask, type ScheduleInput } from "./index";

// Serials: 2026-01-05 is a Monday. serial = days since 1899-12-30.
const S = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
const MON = S(2026, 1, 5);
const iso = (s: number) => new Date((s - 25569) * 86400000).toISOString().slice(0, 10);

const t = (name: string, duration: number, preds: (string | [string, "FS" | "SS" | "FF" | "SF", number])[] = [], extra: Partial<PlanTask> = {}): PlanTask => ({
  name, duration,
  predecessors: preds.map((p) => (typeof p === "string" ? { task: p, type: "FS", lag: 0 } : { task: p[0], type: p[1], lag: p[2] })),
  ...extra,
});
const run = (tasks: PlanTask[], over: Partial<ScheduleInput> = {}) =>
  schedule({ tasks, start: MON, calendar: { workingDays: true }, ...over });
const byName = (out: ReturnType<typeof schedule>, name: string) => out.tasks.find((x) => x.name === name)!;

describe("Calendar", () => {
  it("knows the weekday of a serial and skips weekends and holidays in index space", () => {
    expect(dayOfWeek(MON)).toBe(1);
    expect(dayOfWeek(S(1970, 1, 1))).toBe(4);
    const c = new Calendar(MON, { workingDays: true, holidays: [S(2026, 1, 7)] });
    expect([0, 1, 2, 3, 4, 5].map((k) => iso(c.date(k)))).toEqual(["2026-01-05", "2026-01-06", "2026-01-08", "2026-01-09", "2026-01-12", "2026-01-13"]);
    expect(c.indexCeil(S(2026, 1, 7))).toBe(2);  // the holiday ceils to Thursday
    expect(c.indexFloor(S(2026, 1, 7))).toBe(1); // and floors to Tuesday
    expect(c.indexCeil(S(2026, 1, 10))).toBe(4); // Saturday → Monday
    expect(iso(c.date(-1))).toBe("2026-01-02");  // the Friday before the anchor
    expect(iso(c.date(-2))).toBe("2026-01-01");
    expect(c.indexCeil(S(2026, 1, 3))).toBe(0);  // Saturday before the anchor ceils to the anchor
    expect(c.indexFloor(S(2026, 1, 3))).toBe(-1);
    expect(c.countBetween(MON, S(2026, 1, 9))).toBe(4);
    expect(c.nonWorkingSpans(MON, S(2026, 1, 13))).toEqual([[S(2026, 1, 7), S(2026, 1, 7)], [S(2026, 1, 10), S(2026, 1, 11)]]);
  });
  it("takes the Excel weekend code; calendar mode counts every day", () => {
    const c = new Calendar(MON, { workingDays: true, weekendCode: 7 }); // Fri + Sat
    expect(iso(c.date(4))).toBe("2026-01-11"); // Mon Tue Wed Thu (Sun)
    const all = new Calendar(MON, { workingDays: false });
    expect(iso(all.date(6))).toBe("2026-01-11");
    expect(all.nonWorkingSpans(MON, MON + 30)).toEqual([]);
    expect(() => new Calendar(MON, { workingDays: true, weekendCode: 99 })).not.toThrow();
  });
});

describe("schedule — the forward and backward passes", () => {
  it("chain: FS with lag 0 starts the next working day; float and critical", () => {
    const o = run([t("A", 2), t("B", 3, ["A"])]);
    expect(o.tasks.map((x) => iso(x.start))).toEqual(["2026-01-05", "2026-01-07"]);
    expect(o.tasks.map((x) => iso(x.finish))).toEqual(["2026-01-06", "2026-01-09"]);
    expect(o.tasks.map((x) => x.float)).toEqual([0, 0]);
    expect(o.tasks.every((x) => x.critical)).toBe(true);
    expect(iso(o.projectFinish)).toBe("2026-01-09");
    expect(byName(o, "B").driving).toBe("A");
    expect(o.links).toEqual([{ from: "A", to: "B", type: "FS", lag: 0, driving: true, critical: true, violated: false }]);
  });

  it("the kitchen diamond with a holiday: float on the parallel branch, a closing milestone", () => {
    const o = run([
      t("Demolition", 2), t("Plumbing rough-in", 3, ["Demolition"]), t("Electrical rough-in", 2, ["Demolition"]),
      t("Drywall", 2, ["Plumbing rough-in", "Electrical rough-in"]), t("Paint", 2, ["Drywall"]), t("Cabinets", 4, ["Drywall"]),
      t("Countertops", 5, ["Cabinets", "Paint"]), t("Final inspection", 0, ["Countertops"]),
    ], { calendar: { workingDays: true, holidays: [S(2026, 1, 19)] } });
    expect(o.tasks.map((x) => iso(x.start))).toEqual(["2026-01-05", "2026-01-07", "2026-01-07", "2026-01-12", "2026-01-14", "2026-01-14", "2026-01-21", "2026-01-27"]);
    expect(o.tasks.map((x) => iso(x.finish))).toEqual(["2026-01-06", "2026-01-09", "2026-01-08", "2026-01-13", "2026-01-15", "2026-01-20", "2026-01-27", "2026-01-27"]);
    expect(o.tasks.map((x) => x.float)).toEqual([0, 0, 1, 0, 2, 0, 0, 0]);
    expect(o.tasks.map((x) => x.critical)).toEqual([true, true, false, true, false, true, true, true]);
    expect(byName(o, "Electrical rough-in").freeFloat).toBe(1);
    expect(byName(o, "Drywall").driving).toBe("Plumbing rough-in");
    expect(o.holidays).toEqual([S(2026, 1, 19)]);
    expect(o.nonWorking.length).toBeGreaterThan(2);
    expect(byName(o, "Final inspection").milestone).toBe(true);
  });

  it("link types: SS, FF and SF with lags and a lead", () => {
    const o = run([t("A", 4), t("B", 2, [["A", "SS", 1]]), t("C", 2, [["A", "FF", 0]]), t("D", 1, [["A", "SF", 2]]), t("E", 2, [["A", "FS", -2]])]);
    expect(iso(byName(o, "B").start)).toBe("2026-01-06");   // A.ES + 1
    expect(iso(byName(o, "C").finish)).toBe("2026-01-08");  // = A.finish
    expect(iso(byName(o, "C").start)).toBe("2026-01-07");
    expect(iso(byName(o, "D").finish)).toBe("2026-01-06");  // ends 2 days after A starts (exclusive EF = ES_A + 2)
    expect(iso(byName(o, "E").start)).toBe("2026-01-07");   // A.EF (4) − 2 = index 2
    expect(o.diagnostics.some((d) => d.check === "Lead" && d.task === "E")).toBe(true);
    expect(o.diagnostics.some((d) => d.check === "Link type" && d.task === "B")).toBe(true);
  });

  it("a lead longer than the predecessor puts the successor before the project start", () => {
    const o = run([t("A", 1), t("B", 1, [["A", "FS", -3]])]);
    expect(iso(byName(o, "B").start)).toBe("2026-01-01"); // index −2 = Thu 1 Jan
    expect(iso(o.projectStart)).toBe("2026-01-01");
  });

  it("the one rule: Start is a floor (held when later, ignored when earlier), Finish a ceiling → negative float, Deadline flags", () => {
    const o = run([t("A", 2), t("B", 2, ["A"], { start: S(2026, 1, 12) }), t("C", 2, ["A"], { start: S(2026, 1, 1) })]);
    expect(iso(byName(o, "B").start)).toBe("2026-01-12");
    expect(byName(o, "B").floored).toBe(true);
    expect(byName(o, "B").driving).toBeNull();
    expect(iso(byName(o, "C").start)).toBe("2026-01-07");
    expect(byName(o, "C").floored).toBe(false);
    expect(o.diagnostics.some((d) => d.check === "Held by a typed start" && d.task === "B")).toBe(true);

    const c = run([t("A", 3, [], { finish: S(2026, 1, 6) })]);
    expect(iso(byName(c, "A").finish)).toBe("2026-01-07"); // nothing moved
    expect(byName(c, "A").float).toBe(-1);
    expect(byName(c, "A").critical).toBe(true);
    expect(c.diagnostics.some((d) => d.check === "Negative float")).toBe(true);

    const d = run([t("A", 3, [], { deadline: S(2026, 1, 6) }), t("B", 1, ["A"], { deadline: S(2026, 1, 30) })]);
    expect(byName(d, "A").late).toBe(true);
    expect(byName(d, "A").float).toBe(-1);
    expect(byName(d, "B").late).toBe(false);
    expect(byName(d, "B").float).toBe(0);
    expect(d.diagnostics.some((x) => x.check === "Past deadline" && x.task === "A")).toBe(true);
  });

  it("Manual pins the dates and ignores predecessors but still drives successors; a broken link is flagged", () => {
    const o = run([t("A", 5), t("B", 2, ["A"], { manual: true, start: S(2026, 1, 6) }), t("C", 1, ["B"])]);
    expect(iso(byName(o, "B").start)).toBe("2026-01-06");
    expect(iso(byName(o, "B").finish)).toBe("2026-01-07");
    expect(iso(byName(o, "C").start)).toBe("2026-01-08");
    expect(o.links.find((l) => l.to === "B")!.violated).toBe(true);
    expect(o.diagnostics.some((d) => d.check === "Broken link" && d.task === "B")).toBe(true);
    expect(o.diagnostics.some((d) => d.check === "Manual" && d.task === "B")).toBe(true);
    // Manual with a typed Finish takes its span from the dates.
    const p = run([t("A", 1, [], { manual: true, start: MON, finish: S(2026, 1, 9) })]);
    expect(byName(p, "A").duration).toBe(1);
    expect(iso(byName(p, "A").finish)).toBe("2026-01-09");
  });

  it("nesting: a parent rolls up its children; a link FROM a parent reads the roll-up; a link TO a parent bounds every leaf", () => {
    const o = run([
      { ...t("Phase 1", 0), children: [t("A", 2), t("B", 3, ["A"])] },
      t("C", 1, ["Phase 1"]),
      { ...t("Phase 2", 0, ["C"]), children: [t("D", 1), t("E", 2)] },
    ]);
    expect(o.tasks.map((x) => x.name)).toEqual(["Phase 1", "A", "B", "C", "Phase 2", "D", "E"]);
    expect(o.tasks.map((x) => x.level)).toEqual([0, 1, 1, 0, 0, 1, 1]);
    expect(o.tasks.map((x) => x.wbs)).toEqual(["1", "1.1", "1.2", "2", "3", "3.1", "3.2"]);
    const p1 = byName(o, "Phase 1");
    expect(p1.summary).toBe(true);
    expect(iso(p1.start)).toBe("2026-01-05");
    expect(iso(p1.finish)).toBe("2026-01-09");
    expect(p1.duration).toBe(5);
    expect(iso(byName(o, "C").start)).toBe("2026-01-12");
    expect(iso(byName(o, "D").start)).toBe("2026-01-13");
    expect(iso(byName(o, "E").start)).toBe("2026-01-13");
    expect(byName(o, "D").float).toBe(1);
    expect(byName(o, "Phase 2").critical).toBe(true);
    expect(byName(o, "Phase 2").float).toBe(0);
    // Three authored links, not the four the summary successor expands to.
    expect(o.links.map((l) => `${l.from}→${l.to}`)).toEqual(["A→B", "Phase 1→C", "C→Phase 2"]);
    expect(o.links[2].driving).toBe(true);
  });

  it("progress with a status date: remaining work moves past the status date; a finished task is never critical", () => {
    const o = run([t("A", 4, [], { complete: 50 }), t("B", 2, ["A"]), t("C", 1, [], { complete: 100 })], { statusDate: S(2026, 1, 8) });
    // 2 of 4 days done stay Mon–Tue; the remaining 2 start after 8 Jan (Thu): a split, Fri 9 + Mon 12.
    expect(iso(byName(o, "A").start)).toBe("2026-01-05");
    expect(iso(byName(o, "A").finish)).toBe("2026-01-12");
    expect(byName(o, "A").segments?.length).toBe(2);
    expect(iso(byName(o, "B").start)).toBe("2026-01-13");
    expect(byName(o, "C").critical).toBe(false);
    expect(byName(o, "C").freeFloat).toBe(0);
    expect(o.diagnostics.some((d) => d.check === "Should have finished")).toBe(false);
  });

  it("a summary's SS successor bounds the summary's own float, never one child's late dates", () => {
    // Phase (A 2d, B 3d) starts Mon 5; T starts the same day as the phase (SS) and must finish by Wed 7.
    const o = run([
      { ...t("Phase", 0), children: [t("A", 2), t("B", 3, ["A"])] },
      t("T", 3, [["Phase", "SS", 0]], { finish: S(2026, 1, 7) }),
      t("Tail", 1, ["Phase"]),
    ]);
    expect(byName(o, "T").float).toBe(0);                 // Mon..Wed exactly
    expect(byName(o, "B").float).toBe(0);                 // B ends the phase → the tail
    expect(byName(o, "A").float).toBe(0);
    expect(byName(o, "Phase").float).toBe(0);
    // Now make T's ceiling impossible: the phase's late START goes negative, the children keep their own float.
    const bad = run([
      { ...t("Phase", 0), children: [t("A", 2), t("B", 3, ["A"])] },
      t("T", 3, [["Phase", "SS", 0]], { finish: S(2026, 1, 6) }),
      t("Tail", 5, ["Phase"]),
    ]);
    expect(byName(bad, "Phase").float).toBe(-1);
    expect(byName(bad, "A").float).toBe(0);
    expect(byName(bad, "Phase").critical).toBe(true);
  });

  it("multiple critical paths: every independent chain is critical when asked; one finish otherwise", () => {
    const tasks = [t("A", 5), t("B", 1), t("C", 1, ["B"])];
    const one = run(tasks);
    expect(one.tasks.map((x) => x.critical)).toEqual([true, false, false]);
    expect(byName(one, "C").float).toBe(3);
    const many = run(tasks, { multipleCriticalPaths: true });
    expect(many.tasks.map((x) => x.critical)).toEqual([true, true, true]);
    expect(byName(many, "C").float).toBe(0);
    expect(iso(many.projectFinish)).toBe(iso(one.projectFinish));
  });

  it("structural failures throw one error naming a member: a cycle, an unknown name, a duplicate, a bad duration, a child depending on its parent", () => {
    const err = (tasks: PlanTask[]) => { try { run(tasks); } catch (e) { return e as ScheduleError; } return null; };
    expect(err([t("A", 1, ["B"]), t("B", 1, ["A"])])?.message).toMatch(/loop/);
    expect(err([t("A", 1, ["Z"])])?.message).toMatch(/"Z"/);
    expect(err([t("A", 1), t(" a ", 1)])?.message).toMatch(/twice/);
    expect(err([t("A", -1)])?.message).toMatch(/"A"/);
    expect(err([{ ...t("P", 0), children: [t("A", 1, ["P"])] }])?.message).toMatch(/loop/);
    expect(err([t("A", 1, ["B"]), t("B", 1, ["A"])])).toBeInstanceOf(ScheduleError);
  });

  it("empty plan; a start on a weekend rolls forward; a blank duration is a milestone on the start", () => {
    expect(run([]).tasks).toEqual([]);
    const o = run([t("Kickoff", 0), t("A", 1, ["Kickoff"])], { start: S(2026, 1, 10) });
    expect(o.tasks.map((x) => iso(x.start))).toEqual(["2026-01-12", "2026-01-12"]);
    expect(o.tasks.map((x) => iso(x.finish))).toEqual(["2026-01-12", "2026-01-12"]);
  });

  it("properties on a random DAG: no task starts before a predecessor allows; float ≥ 0 without anchors; a summary bounds its children", () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    for (let trial = 0; trial < 40; trial++) {
      const n = 3 + Math.floor(rnd() * 12);
      const tasks: PlanTask[] = [];
      for (let i = 0; i < n; i++) {
        const preds: PlanTask["predecessors"] = [];
        for (let j = 0; j < i; j++) if (rnd() < 0.3) preds.push({ task: `T${j}`, type: (["FS", "SS", "FF", "SF"] as const)[Math.floor(rnd() * 4)], lag: Math.floor(rnd() * 5) - 1 });
        tasks.push({ name: `T${i}`, duration: Math.floor(rnd() * 6), predecessors: preds });
      }
      const o = run(tasks, { calendar: { workingDays: rnd() < 0.5, holidays: [S(2026, 1, 19)] } });
      const cal = new Calendar(MON, { workingDays: true });
      for (const l of o.links) {
        const a = byName(o, l.from), b = byName(o, l.to);
        expect(l.violated).toBe(false);
        if (l.type === "FS" && a.duration > 0 && b.duration > 0 && l.lag >= 0) expect(b.start).toBeGreaterThan(a.finish);
      }
      for (const x of o.tasks) { expect(x.float).toBeGreaterThanOrEqual(0); expect(x.freeFloat).toBeLessThanOrEqual(x.float); }
      expect(o.tasks.some((x) => x.critical)).toBe(true);
      void cal;
    }
  });
});

describe("predecessor grammar and text", () => {
  it("parses Smartsheet / Project tokens with row numbers, types, lags and units; names pass through", () => {
    const names = ["Demolition", "Framing", "Roof"];
    expect(parsePredecessorText("1FS+2d, 2SS-1w, Roof, 3", names)).toEqual({
      deps: [
        { task: "Demolition", type: "FS", lag: 2 }, { task: "Framing", type: "SS", lag: -5 },
        { task: "Roof", type: "FS", lag: 0 }, { task: "Roof", type: "FS", lag: 0 },
      ],
      errors: [],
    });
    expect(parsePredecessorText("9FS", names).errors).toEqual(["9FS"]);
    expect(predecessorText([{ task: "A", type: "FS", lag: 0 }, { task: "B", type: "SS", lag: 2 }, { task: "C", type: "FS", lag: -1 }])).toBe("A, B SS+2, C FS-1");
  });
});

describe("mermaid", () => {
  it("excludes weekends + holidays, sections per group, crit / milestone / done tags, exclusive ends, nested indent", () => {
    const o = run([t("A", 2, [], { group: "Prep" }), t("B", 1, ["A"], { group: "Prep", complete: 100 }), t("Done", 0, ["B"], { group: "Wrap" })], { calendar: { workingDays: true, holidays: [S(2026, 1, 6)] } });
    expect(mermaidGantt(o, iso).split("\n")).toEqual([
      "gantt", "    dateFormat YYYY-MM-DD", "    axisFormat %d %b", "    excludes weekends, 2026-01-06",
      "    section Prep",
      "    A :crit, t0, 2026-01-05, 2026-01-08",
      "    B :done, t1, 2026-01-08, 2026-01-09",
      "    section Wrap",
      "    Done :milestone, crit, t2, 2026-01-08, 0d",
    ]);
  });
});

describe("review pins: milestones, splits, grammar", () => {
  it("a milestone with a typed Start inside a phase sits ON that date", () => {
    const wed = S(2026, 1, 14);
    const out = run([{ name: "Phase", duration: 0, predecessors: [], children: [t("A", 3), t("M", 0, [], { start: wed })] }]);
    expect(iso(byName(out, "M").start)).toBe("2026-01-14");
    expect(iso(byName(out, "M").finish)).toBe("2026-01-14");
  });

  it("a started task whose done part rounds to nothing moves whole past the status date, no split", () => {
    const out = run([t("A", 3, [], { complete: 10 })], { statusDate: MON + 7, splitInProgress: true });
    const a = byName(out, "A");
    expect(a.segments).toBeUndefined();
    expect(a.start).toBeGreaterThan(MON + 7);
    expect(a.finish).toBeGreaterThanOrEqual(a.start);
  });

  it("a zero-float milestone's early and late dates equal its displayed date", () => {
    const out = run([t("A", 2), t("M", 0, ["A"])]);
    const m = byName(out, "M");
    expect(m.float).toBe(0);
    expect([m.earlyStart, m.earlyFinish, m.lateStart, m.lateFinish]).toEqual([m.start, m.finish, m.start, m.finish]);
  });

  it("the grammar keeps an elapsed unit and a sub-day lag", () => {
    const { deps } = parsePredecessorText("1FS+2ed, 1FS+4h", ["A"]);
    expect(deps).toEqual([{ task: "A", type: "FS", lag: 2, elapsed: true }, { task: "A", type: "FS", lag: 0.5 }]);
  });
});
