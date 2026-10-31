// [[C69]], [[C70]], [[C71]], [[D99]] rustIsSpec
// The Schedule, Gantt and Earned Value cards over the plans their columns can hold: each path of the tasks reader,
// the links frame, the calendars and the figure's payload, driven through `data()` so the cards' bodies are held to it.
import { describe, it, expect } from "vitest";
import { ScheduleNode } from "../../../src/graph/nodes/schedule";
import { GanttNode } from "../../../src/graph/nodes/gantt";
import { EarnedValueNode } from "../../../src/graph/nodes/earnedValue";
import { parseDateToSerial } from "../../../src/graph/nodes/dateSerial";
import { isSolError, solError } from "../../../src/graph/errorValue";
import { cubeFromColumns, isCubeValue, isFrameValue, type CubeCell, type CubeValue, type FrameValue } from "../../../src/graph/frame";
import { columnUnitFromSpec, tagFrameCellUnit } from "../../../src/graph/unitColumn";
import { isChartValue } from "../../../src/graph/chartValue";
import { scheduleTasks } from "../scheduleOnCard";

const d = (iso: string) => parseDateToSerial(iso);
const MON = d("2026-01-05");
type Col = { name: string; cells: CubeCell[]; type?: "string" | "number" | "date" | "logical" };
const cube = (...cols: Col[]) => cubeFromColumns(cols);
const frame = (cols: Record<string, CubeCell[]>): FrameValue => ({
  __frame: true,
  columns: Object.entries(cols).map(([name, values]) => ({ name, type: values.some((v) => typeof v === "number") ? "number" as const : "string" as const, values: values as never })),
});
const hours = (h: number) => ({ __unitCell: true, value: h * 3600, dim: { time: 1 } }) as unknown as CubeCell;
const metres = (m: number) => ({ __unitCell: true, value: m, dim: { length: 1 } }) as unknown as CubeCell;
const links = (rows: [string, string, string, number][]) => cube(
  { name: "Task", cells: rows.map((r) => r[0]), type: "string" },
  { name: "Type", cells: rows.map((r) => r[2]), type: "string" },
  { name: "Lag", cells: rows.map((r) => r[3]), type: "number" },
);

function sched(c: CubeValue, init: ConstructorParameters<typeof ScheduleNode>[0] = {}, inputs: Record<string, unknown[]> = {}) {
  const n = new ScheduleNode(init);
  const out = n.data({ tasks: [c], start: [MON], ...inputs } as never);
  return { n, out };
}

const plain = cube(
  { name: "Task", cells: ["A", "B", "C", "D"], type: "string" },
  { name: "Duration", cells: [2, 3, 1, 0], type: "number" },
  { name: "Predecessors", cells: [[], ["A"], ["A"], ["B", "C"]] },
);

describe("the Schedule card reads every column of a plan", () => {
  it("each card option over one plan", () => {
    for (const mode of ["working", "calendar"] as const) {
      for (const precision of ["days", "minutes"] as const) {
        for (const criticalPaths of ["one", "many", "longest"] as const) {
          const { out } = sched(plain, { mode, precision, criticalPaths });
          expect(isCubeValue(out.cube)).toBe(true);
        }
      }
    }
    for (const progress of ["split", "move"] as const) {
      const c = cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: [4, 2] }, { name: "Complete", cells: [50, 0] }, { name: "Predecessors", cells: [[], ["A"]] });
      expect(isCubeValue(sched(c, { progress }, { status: [d("2026-01-08")] }).out.cube)).toBe(true);
      expect(isCubeValue(sched(c, { progress, precision: "minutes" }, { status: [d("2026-01-08")] }).out.cube)).toBe(true);
    }
  });

  it("the calendar inputs: holidays, weekend codes, hours, an unwired start, a blank or text start", () => {
    for (const code of [1, 2, 7, 11, 17, 3.6]) expect(isCubeValue(sched(plain, {}, { weekend_code: [code] }).out.cube)).toBe(true);
    expect(sched(plain, {}, { weekend_code: [99] }).out.cube).toMatchObject({ code: "#VALUE!" });
    expect(isCubeValue(sched(plain, {}, { holidays: [[d("2026-01-06"), null, d("2026-01-07")]] }).out.cube)).toBe(true);
    expect(isCubeValue(sched(plain, { mode: "calendar" }, { holidays: [[d("2026-01-06")]] }).out.cube)).toBe(true);
    for (const h of [4, 6, 10, 20, 0, -2]) {
      expect(isCubeValue(sched(plain, { precision: "minutes" }, { hours: [h] }).out.cube)).toBe(true);
      expect(isCubeValue(sched(plain, {}, { hours: [h] }).out.cube)).toBe(true);
    }
    expect(isCubeValue(new ScheduleNode().data({ tasks: [plain] }).cube)).toBe(true);
    expect(new ScheduleNode().data({ tasks: [plain], start: [null] }).cube).toBeNull();
    expect(new ScheduleNode().data({ tasks: [plain], start: [] }).cube).toBeNull();
    expect(new ScheduleNode().data({ tasks: [null] }).cube).toBeNull();
    expect(isCubeValue(sched(plain, {}, { status: [d("2026-01-06")] }).out.cube)).toBe(true);
    expect(isCubeValue(sched(plain, {}, { status: [null] }).out.cube)).toBe(true);
  });

  it("the aliases of each column, the duration fallback and the Work and Units columns", () => {
    const named = cube(
      { name: "title", cells: ["Design", "Build"], type: "string" },
      { name: "days", cells: [2, 3], type: "number" },
      { name: "depends on", cells: [null, "design"] },
      { name: "due", cells: [null, d("2026-01-08")], type: "date" },
      { name: "pinned", cells: ["no", "yes"] },
      { name: "end", cells: [null, null], type: "date" },
      { name: "% complete", cells: [100, 20], type: "number" },
      { name: "section", cells: ["Plan", ""], type: "string" },
      { name: "as late as possible", cells: [false, "on"] },
      { name: "started", cells: [null, null], type: "date" },
      { name: "notes", cells: ["x", "y"], type: "string" },
    );
    expect(isCubeValue(sched(named).out.cube)).toBe(true);
    const fallback = cube({ name: "Task", cells: ["A", "B"] }, { name: "Estimate", cells: [2, hours(12)] }, { name: "after", cells: [[], ["A"]] });
    expect(isCubeValue(sched(fallback).out.cube)).toBe(true);
    const effort = cube({ name: "Task", cells: ["A", "B", "C"] }, { name: "effort", cells: [16, 8, null] }, { name: "fte", cells: [2, 0, null] }, { name: "Duration", cells: [null, "", 1] });
    expect(isCubeValue(sched(effort).out.cube)).toBe(true);
    const textDur = cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: ["2", hours(4)] });
    expect(isCubeValue(sched(textDur, {}, { hours: [4] }).out.cube)).toBe(true);
    const textDates = cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: [1, 1] }, { name: "Start", cells: ["2026-01-07", null] }, { name: "Deadline", cells: [null, "12-Jan-2026"] }, { name: "Finish", cells: [null, d("2026-01-09")], type: "date" });
    expect(isCubeValue(sched(textDates).out.cube)).toBe(true);
  });

  it("each cell the reader refuses names its task", () => {
    const bad: CubeValue[] = [
      cube({ name: "Duration", cells: [1] }),
      cube({ name: "Task", cells: ["A"] }, { name: "Notes", cells: ["x"] }),
      cube({ name: "Task", cells: ["A", ""] }, { name: "Duration", cells: [1, 1] }),
      cube({ name: "Task", cells: ["A", null] }, { name: "Duration", cells: [1, 1] }),
      cube({ name: "Task", cells: ["A"] }, { name: "Duration", cells: [-1] }),
      cube({ name: "Task", cells: ["A"] }, { name: "Duration", cells: ["soon"] }),
      cube({ name: "Task", cells: ["A"] }, { name: "Duration", cells: [metres(3)] }),
      cube({ name: "Task", cells: ["A"] }, { name: "Duration", cells: [1] }, { name: "Start", cells: ["05/06/2026"] }),
      cube({ name: "Task", cells: ["A"] }, { name: "Duration", cells: [1] }, { name: "Deadline", cells: ["whenever 2026"] }),
      cube({ name: "Task", cells: ["A"] }, { name: "Duration", cells: [1] }, { name: "Actual start", cells: ["not a date"] }),
      cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: [1, 1] }, { name: "Predecessors", cells: [[], links([["A", "", "XX", 0]])] }),
      cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: [1, 1] }, { name: "Predecessors", cells: [[], links([["A", "", "FS", NaN]])] }),
      cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: [1, 1] }, { name: "Predecessors", cells: [[], cube({ name: "Lag", cells: [1] })] }),
      cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: [1, 1] }, { name: "Predecessors", cells: [["B"], ["A"]] }),
      cube({ name: "Task", cells: ["A", "a "] }, { name: "Duration", cells: [1, 1] }),
      cube({ name: "Task", cells: ["A"] }, { name: "Duration", cells: [1] }, { name: "Predecessors", cells: [["Nobody"]] }),
      cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: [1, 1] }, { name: "Active", cells: [true, "maybe"] }),
      cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: [1, 1] }, { name: "Active", cells: [true, solError("#REF!", "gone") as never] }),
      cube({ name: "Task", cells: ["A"] }, { name: "Duration", cells: [3e6] }),
    ];
    for (const c of bad) {
      const { n, out } = sched(c);
      expect(isSolError(out.cube)).toBe(true);
      expect(n.cachedOutput).toBeNull();
    }
  });

  it("typed links, elapsed lags, a lead and every link type", () => {
    const c = cube(
      { name: "Task", cells: ["A", "B", "C", "D", "E"] },
      { name: "Duration", cells: [4, 2, 2, 1, 2] },
      { name: "Predecessors", cells: [
        null,
        links([["A", "", "ss", 1]]),
        cube({ name: "Predecessor", cells: ["A"] }, { name: "link", cells: ["FF"] }, { name: "offset", cells: ["1"] }),
        cube({ name: "Task", cells: ["A", "B"] }, { name: "kind", cells: ["SF", null] }, { name: "lead", cells: [2, ""] }, { name: "Elapsed", cells: [true, false] }),
        links([["A", "", "FS", -2], ["", "", "FS", 0]]),
      ] },
    );
    for (const precision of ["days", "minutes"] as const) expect(isCubeValue(sched(c, { precision }).out.cube)).toBe(true);
  });

  it("the Links frame: aliases, a skipped blank row, an inactive successor and each refusal", () => {
    const tasks = cube({ name: "Task", cells: ["A", "B", "C", "Off"] }, { name: "Duration", cells: [2, 1, 1, 1] }, { name: "Active", cells: [true, true, true, false] });
    const ok = [
      frame({ to: ["B", "C", "", "Off"], from: ["A", "A", "A", "A"], kind: ["FS", "ss", "FS", "FS"], offset: [0, 1, 0, 0] }),
      frame({ Successor: ["B"], Predecessors: ["A"] }),
      frame({ task: ["C"], after: ["B"], link: ["FF"], lead: ["2"] }),
    ];
    for (const l of ok) expect(isCubeValue(sched(tasks, {}, { links: [l] }).out.cube)).toBe(true);
    const typed = cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: [1, 1] }, { name: "Predecessors", cells: [[], ["A"]] });
    expect(isCubeValue(sched(typed, {}, { links: [frame({ Successor: ["B"], Predecessor: ["A"], Type: ["SS"], Lag: [1] })] }).out.cube)).toBe(true);
    const refused = [
      frame({ Name: ["B"], Predecessor: ["A"] }),
      frame({ Successor: ["B"], Before: ["A"] }),
      frame({ Successor: ["Ghost"], Predecessor: ["A"] }),
      frame({ Successor: ["B"], Predecessor: ["A"], Type: ["XY"] }),
      frame({ Successor: ["B"], Predecessor: ["A"], Lag: ["soon"] }),
    ];
    for (const l of refused) expect(isSolError(sched(tasks, {}, { links: [l] }).out.cube)).toBe(true);
  });

  it("nesting, Repeat and Every, Active, per-task calendars and ALAP", () => {
    const kids = cube({ name: "Task", cells: ["A", "B"] }, { name: "Duration", cells: [2, 3] }, { name: "Predecessors", cells: [[], ["A"]] }, { name: "Project", cells: ["P", "P"] });
    const deep = cube({ name: "Task", cells: ["Inner"] }, { name: "steps", cells: [kids] });
    const plan = cube(
      { name: "Task", cells: ["Phase", "Standup", "Review", "Off", "Wrap"] },
      { name: "subtasks", cells: [deep, null, null, kids, null] },
      { name: "Duration", cells: [null, 0.5, 1, 1, 1] },
      { name: "Repeat", cells: [null, 3, null, null, null] },
      { name: "Every", cells: [null, 2, null, null, null] },
      { name: "Start", cells: [null, d("2026-01-06"), null, null, null], type: "date" },
      { name: "Active", cells: [true, "yes", 1, "off", ""] },
      { name: "Weekend", cells: [null, null, 7, null, 2] },
      { name: "Hours", cells: [null, 4, null, null, 6] },
      { name: "Holidays", cells: [null, null, [d("2026-01-07"), "x"], null, null] },
      { name: "ALAP", cells: [false, false, true, false, false] },
      { name: "Predecessors", cells: [null, ["Phase"], [], [], ["Review", "Standup"]] },
    );
    for (const precision of ["days", "minutes"] as const) {
      expect(isCubeValue(sched(plan, { precision }).out.cube)).toBe(true);
      expect(isCubeValue(sched(plan, { precision, criticalPaths: "longest" }, { status: [d("2026-01-09")] }).out.cube)).toBe(true);
    }
    const elapsed = cube({ name: "Task", cells: ["Cure", "Next"] }, { name: "Duration", cells: [3, 1] }, { name: "Elapsed", cells: [true, false] }, { name: "Predecessors", cells: [[], ["Cure"]] });
    expect(isCubeValue(sched(elapsed, {}, { start: [d("2026-01-09")] }).out.cube)).toBe(true);
    const repeatOnly = cube({ name: "Task", cells: ["Pour", "Check"] }, { name: "Duration", cells: [1, 1] }, { name: "times", cells: [null, 2.7] }, { name: "interval", cells: [null, 5] }, { name: "Predecessors", cells: [[], links([["Pour", "", "FS", 2]])] });
    expect(isCubeValue(sched(repeatOnly).out.cube)).toBe(true);
  });

  it("progress against the status date: done, started, an actual start, a manual pin with a finish", () => {
    const c = cube(
      { name: "Task", cells: ["A", "B", "C", "D", "E"] },
      { name: "Duration", cells: [4, 3, 2, 2, 1] },
      { name: "Complete", cells: [100, 50, 10, 0, "x"] },
      { name: "Actual start", cells: [null, null, d("2026-01-06"), null, null], type: "date" },
      { name: "Manual", cells: [false, false, false, true, false] },
      { name: "Start", cells: [null, null, null, d("2026-01-07"), d("2026-01-20")], type: "date" },
      { name: "Finish", cells: [null, null, null, d("2026-01-12"), null], type: "date" },
      { name: "Deadline", cells: [d("2026-01-06"), null, null, null, d("2026-01-02")], type: "date" },
      { name: "Predecessors", cells: [[], ["A"], ["A"], ["B"], ["C"]] },
    );
    for (const status of [d("2026-01-05"), d("2026-01-08"), d("2026-02-20")]) {
      for (const progress of ["split", "move"] as const) {
        for (const precision of ["days", "minutes"] as const) {
          expect(isCubeValue(sched(c, { progress, precision }, { status: [status] }).out.cube)).toBe(true);
        }
      }
    }
  });
});

describe("the Gantt card's payload", () => {
  const scheduled = (c: CubeValue, opts: Partial<Parameters<typeof scheduleTasks>[1]> = {}) => scheduleTasks(c, { start: MON, workingDays: true, ...opts }).cube;

  it("each view option and the calendar inputs", () => {
    const s = scheduled(plain);
    const options = [
      "layout=calendar;fit=page;zoom=day;tiers=1;collapse=2;fiscal_start=4;week=us",
      "layout=gantt;zoom=quarter;tiers=3;collapse=-1;fiscal_start=13;week=iso;columns=name, start,float,bogus",
      "window=2026-02-01,2026-01-01;critical=yes;baseline=n;arrows=0;today=off;status=1;weekends=on;group_by=false;labels=y;minutes=true;histogram=no",
      "window=nope,2026-01-01;zoom=fortnight;critical=maybe;title=Plan;columns=",
      "=;;zoom;ZOOM=Month",
      "",
    ];
    for (const o of options) {
      const n = new GanttNode();
      n.stringLiterals.options = o;
      expect(isChartValue(n.data({ schedule: [s] }).chart)).toBe(true);
    }
    const n = new GanttNode();
    expect(isChartValue(n.data({ schedule: [s], options: ["zoom=week"] }).chart)).toBe(true);
    expect(isChartValue(n.data({ schedule: [s], options: [7 as never] }).chart)).toBe(true);
    expect(isChartValue(n.data({ schedule: [s], weekend_code: [11], holidays: [[d("2026-01-06"), null]], status: [d("2026-01-07")] }).chart)).toBe(true);
    expect(isChartValue(n.data({ schedule: [s], status: [null] }).chart)).toBe(true);
    const labelled = new GanttNode({ label: "Remodel" });
    expect(isChartValue(labelled.data({ schedule: [s] }).chart)).toBe(true);
  });

  it("the cells the figure reads: segments, deadlines, colours, resources, baselines and the links' breaks", () => {
    const c = cube(
      { name: "Task", cells: ["A", "B", "C", "D", "E", "F"] },
      { name: "Duration", cells: [4, 2, 2, 1, 0, 2] },
      { name: "Complete", cells: [50, 0, 120, 0, 0, -5] },
      { name: "Deadline", cells: [d("2026-01-06"), "2026-01-20", null, null, null, null] },
      { name: "Color", cells: ["#f00", " ", null, "blue", null, null] },
      { name: "Resource", cells: ["Ana", null, "Bo", "", null, null] },
      { name: "Units", cells: [0.5, null, -1, null, null, null] },
      { name: "Predecessors", cells: [[], links([["A", "", "SS", 1]]), links([["A", "", "FF", 0]]), links([["A", "", "SF", 0]]), ["D"], links([["E", "", "FS", -1]])] },
    );
    const s = scheduleTasks(c, { start: MON, workingDays: true, statusDate: d("2026-01-07") }).cube;
    const base = scheduled(c, { start: d("2026-01-01") });
    const n = new GanttNode();
    expect(isChartValue(n.data({ schedule: [s], baseline: [base] }).chart)).toBe(true);
    expect(isChartValue(n.data({ schedule: [s], baseline: [cube({ name: "Duration", cells: [1] })] }).chart)).toBe(true);
    expect(isChartValue(n.data({ schedule: [s], baseline: [frame({ Task: ["A"], Start: [MON], Finish: [MON + 1] })] }).chart)).toBe(true);
    const minutes = scheduleTasks(c, { start: MON, workingDays: true, precision: "minutes" }).cube;
    expect(isChartValue(n.data({ schedule: [minutes] }).chart)).toBe(true);
    const nested = cube({ name: "Task", cells: ["Phase", "Wrap"] }, { name: "Tasks", cells: [c, null] }, { name: "Duration", cells: [null, 1] }, { name: "Predecessors", cells: [null, ["Phase"]] }, { name: "Section", cells: ["One", "Two"] });
    expect(isChartValue(n.data({ schedule: [scheduled(nested)] }).chart)).toBe(true);
  });

  it("a hand-made table: aliases, a frame, text dates, a broken link, and the refusals", () => {
    const n = new GanttNode();
    const f = frame({ Name: ["A", "B", "C"], Start: [MON, MON + 1, MON + 3], Finish: [MON + 1, MON + 1, MON + 2], Days: [2, 0, 1], Float: [0, -1, 2], Critical: ["y", "no", 1], Late: [0, "on", "x"], after: ["", "A", "B"], Driving: ["", "a", "B"], Group: ["G", "", "H"], owner: ["Ana", "Bo", ""] });
    expect(isChartValue(n.data({ schedule: [f] }).chart)).toBe(true);
    const c = cube(
      { name: "title", cells: ["A", "B", "C", "D"] },
      { name: "Start", cells: [MON, MON + 2, MON + 2.5, MON + 4] },
      { name: "Finish", cells: [MON + 2, MON + 2, MON + 3, MON + 4] },
      { name: "blocked by", cells: [null, ["A"], cube({ name: "Name", cells: ["B", " "] }, { name: "Type", cells: ["XX", "FS"] }, { name: "Lag", cells: ["2", null] }), "C"] },
      { name: "Summary", cells: [false, false, "yes", false] },
      { name: "due", cells: [null, null, null, MON + 3] },
      { name: "Manual", cells: [null, "on", 0, true] },
      { name: "Active", cells: [true, true, true, "off"] },
    );
    expect(isChartValue(n.data({ schedule: [c] }).chart)).toBe(true);
    for (const bad of [
      cube({ name: "Task", cells: ["X"] }),
      cube({ name: "Task", cells: ["X"] }, { name: "Start", cells: [MON] }, { name: "Finish", cells: ["soon"] }),
      cube({ name: "Duration", cells: [1] }),
    ]) {
      expect(isSolError(n.data({ schedule: [bad] }).chart)).toBe(true);
    }
    expect(isSolError(n.data({ schedule: [solError("#N/A", "upstream")] }).chart)).toBe(true);
    expect(n.data({ schedule: ["text" as never] }).chart).toBeNull();
    expect(n.data({}).chart).toBeNull();
    const empty = cube({ name: "Task", cells: [] }, { name: "Start", cells: [] }, { name: "Finish", cells: [] });
    expect(isChartValue(n.data({ schedule: [empty] }).chart)).toBe(true);
  });
});

describe("the Earned Value card", () => {
  const usd = columnUnitFromSpec("$")!;
  const eur = columnUnitFromSpec("€")!;
  const plan = (extra: Col[] = []) => cube(
    { name: "Task", cells: ["A", "B", "C", ""] },
    { name: "Cost", cells: [1000, 2000, 500, 10] },
    { name: "Complete", cells: [100, 50, 150, 0] },
    { name: "Start", cells: [d("2026-01-05"), d("2026-01-07"), d("2026-01-12"), null], type: "date" },
    { name: "Finish", cells: [d("2026-01-06"), d("2026-01-09"), d("2026-01-16"), null], type: "date" },
    ...extra,
  );

  it("status dates before, inside and after the plan; an unwired status reads today", () => {
    for (const status of [d("2026-01-01"), d("2026-01-05"), d("2026-01-07") + 0.5, d("2026-01-08"), d("2026-01-13"), d("2026-03-01")]) {
      const out = new EarnedValueNode().data({ schedule: [plan()], status: [status] });
      expect(isFrameValue(out.frame) || out.frame === null).toBe(true);
    }
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [plan()] }).frame)).toBe(true);
    expect(new EarnedValueNode().data({ schedule: [plan()], status: [null] }).frame).toBeNull();
    expect(new EarnedValueNode().data({ schedule: [plan()], status: [NaN] }).frame).toBeNull();
  });

  it("actual costs, a named cost column, a baseline by name and the calendar inputs", () => {
    const status = [d("2026-01-08")];
    const actual = plan([{ name: "Actual cost", cells: [900, null, 0, 1] }]);
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [actual], status }).frame)).toBe(true);
    const spent = plan([{ name: "spent", cells: [1200, 1500, 300, 0] }]);
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [spent], status }).frame)).toBe(true);
    const named = cube({ name: "name", cells: ["A", "B"] }, { name: "Price", cells: [10, 20] }, { name: "progress", cells: [50, -10] }, { name: "Budget", cells: [1, 2] });
    for (const cost of ["Price", " price ", "", "Missing"]) {
      const n = new EarnedValueNode();
      n.stringLiterals.cost = cost;
      expect(isFrameValue(n.data({ schedule: [named], status }).frame)).toBe(true);
      expect(isFrameValue(n.data({ schedule: [named], status, cost: ["bac"] }).frame)).toBe(true);
    }
    const base = cube({ name: "Task", cells: ["b", "A", "A"] }, { name: "BAC", cells: [4000, 800, 1] }, { name: "Start", cells: [d("2026-01-05"), null, null] }, { name: "end", cells: [d("2026-01-16"), null, null] });
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [plan()], baseline: [base], status }).frame)).toBe(true);
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [plan()], baseline: [frame({ Title: ["C"], Cost: [50] })], status }).frame)).toBe(true);
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [plan()], baseline: [null], status }).frame)).toBe(true);
    for (const code of [2, 7, 11, 17]) expect(isFrameValue(new EarnedValueNode().data({ schedule: [plan()], status, weekend_code: [code] }).frame)).toBe(true);
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [plan()], status, holidays: [[d("2026-01-06"), null, d("2026-01-13")]] }).frame)).toBe(true);
  });

  it("currencies on the cost, the actuals and the baseline; a frame schedule; the refusals", () => {
    const status = [d("2026-01-08")];
    const tag = (u: typeof usd, xs: number[]) => xs.map((x) => tagFrameCellUnit(x, u) as CubeCell);
    const money = cube({ name: "Task", cells: ["A", "B"] }, { name: "Cost", cells: tag(usd, [1000, 3000]) }, { name: "Actual", cells: tag(usd, [500, 100]) }, { name: "Complete", cells: [40, 10] });
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [money], status }).frame)).toBe(true);
    const baseMoney = cube({ name: "Task", cells: ["A"] }, { name: "Cost", cells: tag(eur, [900]) });
    const noCost = cube({ name: "Task", cells: ["A", "B"] }, { name: "Complete", cells: [40, 10] });
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [noCost], baseline: [baseMoney], status }).frame)).toBe(true);
    const f = frame({ Task: ["A", "B"], Cost: [10, 20], Complete: [100, 0] });
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [f], status }).frame)).toBe(true);
    const textOnly = cube({ name: "Label", cells: [1, "two"] }, { name: "Cost", cells: [5, 6] });
    expect(isFrameValue(new EarnedValueNode().data({ schedule: [textOnly], status }).frame)).toBe(true);
    expect(isSolError(new EarnedValueNode().data({ schedule: [cube({ name: "Cost", cells: [1] })], status }).frame)).toBe(true);
    expect(isSolError(new EarnedValueNode().data({ schedule: [solError("#N/A", "upstream")] }).frame)).toBe(true);
    expect(new EarnedValueNode().data({ schedule: ["x" as never], status }).frame).toBeNull();
  });
});
