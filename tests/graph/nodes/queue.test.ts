// [[A1]] visualGraphCalculator: the Greedy Queue card's loop, its rule written as LAMBDA cards.
import { describe, it, expect } from "vitest";
import { GreedyQueueNode } from "../../../src/graph/nodes/queue";
import { LambdaNode } from "../../../src/graph/nodes/lambda";
import { extractInit } from "../../../src/graph/nodeInit";
import { isSolError } from "../../../src/graph/errorValue";

type Row = Record<string, unknown>;
const frame = (rows: Row[]) => {
  const names = Object.keys(rows[0]);
  return { __frame: true, columns: names.map((name) => ({
    name, type: typeof rows[0][name] === "number" ? "number" : "string", values: rows.map((r) => r[name] ?? null),
  })) } as never;
};
const rows = (f: unknown): Row[] => {
  const cols = (f as { columns: { name: string; values: unknown[] }[] }).columns;
  return (cols[0]?.values ?? []).map((_, i) => Object.fromEntries(cols.map((c) => [c.name, c.values[i]])));
};
const lambda = (params: string, expr: string) => new LambdaNode({ params, expr }).data({}).result;
const run = (n: GreedyQueueNode, inputs: Record<string, unknown>) =>
  n.data(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, [v]]))) as { picks: unknown; left: unknown };

// A one-dimensional "place", so a distance is a difference anyone can check by eye.
const job = (group: string, step: number, priority: number, x: number, hours = 1) => ({ Group: group, Step: step, Priority: priority, X: x, Hours: hours });
const DIST = "IF(ISBLANK(last_X), 0, ABS(X - last_X))";

describe("Greedy Queue", () => {
  it("picks the first by Order by each step, a list sorting by its first value then its next; unwired, the first in line", () => {
    const items = frame([job("A", 1, 2, 0), job("A", 1, 5, 9), job("A", 1, 5, 1), job("B", 2, 1, 4), job("A", 3, 1, 0)]);
    const order = lambda("Priority, X, last_X", `HSTACK(-Priority, ${DIST})`);
    const start = frame([{ Group: "A", X: 0 }]);
    const out = run(new GreedyQueueNode(), { items, start, order, group: "Group", step: "Step", steps: 3 });
    expect(rows(out.picks).map((r) => [r.Group, r.X, r.Picked, r.Wait])).toEqual([["A", 1, 1, 0], ["A", 9, 2, 1], ["B", 4, 2, 0], ["A", 0, 3, 2]]);
    expect(rows(out.left).map((r) => r.Step)).toEqual([3]);
    const fifo = run(new GreedyQueueNode(), { items, group: "Group", step: "Step", steps: 3 });
    expect(rows(fifo.picks).filter((r) => r.Group === "A").map((r) => r.X)).toEqual([0, 9, 1]);
  });

  it("orders by a column either way, blanks last, Then by breaking its ties, and adds the Cost column to the Cost formula", () => {
    const items = frame([{ Job: "a", Due: 3, Hours: 2, X: 9 }, { Job: "b", Due: 1, Hours: 1, X: 5 }, { Job: "c", Due: 3, Hours: 4, X: 1 }, { Job: "d", Due: null, Hours: 1, X: 0 }]);
    const pick = (n: GreedyQueueNode, extra: Record<string, unknown> = {}) => rows(run(n, { items, ...extra }).picks).map((r) => r.Job);
    const by = (dir: "asc" | "desc") => Object.assign(new GreedyQueueNode({ orderDir: dir }), { stringLiterals: { group: "", step: "", orderColumn: "Due", costColumn: "" } });
    expect(pick(by("asc"))).toEqual(["b", "a", "c", "d"]);
    expect(pick(by("desc"))).toEqual(["a", "c", "b", "d"]);
    expect(pick(by("desc"), { order: lambda("X", "X") })).toEqual(["c", "a", "b", "d"]);
    const costed = Object.assign(new GreedyQueueNode(), { stringLiterals: { group: "", step: "", orderColumn: "", costColumn: "Hours" } });
    const out = run(costed, { items, cost: lambda("X", "X") }) as { picks: unknown; total: number };
    expect(rows(out.picks).map((r) => r.Cost)).toEqual([11, 6, 5, 1]);
    expect(out.total).toBe(23);
    const missing = Object.assign(new GreedyQueueNode(), { stringLiterals: { group: "", step: "", orderColumn: "Nope", costColumn: "" } });
    expect(isSolError(run(missing, { items }).picks)).toBe(true);
  });

  it("spends a budget a step by the Cost formula, the step's first pick always", () => {
    const items = frame([job("A", 1, 1, 0, 2), job("A", 1, 1, 1, 2), job("A", 1, 1, 2, 2), job("A", 1, 1, 3, 2)]);
    const cost = lambda("Hours, X, last_X", `Hours + ${DIST}`);
    const out = run(new GreedyQueueNode(), { items, cost, budget: 6, steps: 1 });
    expect(rows(out.picks).map((r) => [r.X, r.Cost, r["Used Before"]])).toEqual([[0, 2, 0], [1, 3, 2]]);
    expect(rows(out.left)).toHaveLength(2);
    const big = run(new GreedyQueueNode(), { items: frame([job("A", 1, 1, 0, 9)]), cost, budget: 6, steps: 1 });
    expect(rows(big.picks)).toHaveLength(1);
  });

  it("reads last_ from the Start row each step when set to", () => {
    const items = frame([job("A", 1, 1, 5), job("A", 2, 1, 7)]);
    const cost = lambda("X, last_X", DIST);
    const start = frame([{ Group: "A", X: 0 }]);
    const cont = run(new GreedyQueueNode(), { items, start, cost, group: "Group", step: "Step" });
    expect(rows(cont.picks).map((r) => r.Cost)).toEqual([5, 2]);
    const home = run(new GreedyQueueNode({ stepStart: "start" }), { items, start, cost, group: "Group", step: "Step" });
    expect(rows(home.picks).map((r) => r.Cost)).toEqual([5, 7]);
  });

  it("tries the next in order when set to, so a budget fills like a packed truck", () => {
    // First-fit decreasing: heaviest first, each truck (a step) holds 10.
    const items = frame([5, 7, 3, 4, 2].map((w, i) => ({ Box: `B${i + 1}`, Weight: w })));
    const order = lambda("Weight", "-Weight");
    const cost = lambda("Weight", "Weight");
    const trucks = (mode: "stop" | "skip") => {
      const out = run(new GreedyQueueNode({ mode }), { items, order, cost, budget: 10, steps: 3 });
      return [1, 2, 3].map((t) => rows(out.picks).filter((r) => r.Picked === t).map((r) => r.Box));
    };
    expect(trucks("skip")).toEqual([["B2", "B3"], ["B1", "B4"], ["B5"]]);
    expect(trucks("stop")).toEqual([["B2"], ["B1", "B4"], ["B3", "B5"]]);
    // Steps left blank: as many trucks as it takes.
    const all = run(new GreedyQueueNode({ mode: "skip" }), { items, order, cost, budget: 10 });
    expect(Math.max(...rows(all.picks).map((r) => r.Picked as number))).toBe(3);
  });

  it("treats items without the group column as anyone's when Start names the groups", () => {
    const items = frame([6, 2, 5, 3].map((h, i) => ({ Job: `J${i + 1}`, Hours: h })));
    const start = frame([{ Machine: "M1" }, { Machine: "M2" }]);
    const out = run(new GreedyQueueNode(), { items, start, order: lambda("Hours", "Hours"), cost: lambda("Hours", "Hours"), group: "Machine", budget: 8 });
    expect(rows(out.picks).map((r) => [r.Machine, r.Job, r.Picked])).toEqual([["M1", "J2", 1], ["M2", "J4", 1], ["M1", "J3", 1], ["M1", "J1", 2]]);
  });

  it("shares an item with a blank group among the groups, which take turns, and Start can name a group with no items", () => {
    // Two machines from Start; four jobs anyone may run, shortest first, each machine 8 hours a day.
    const items = frame([6, 2, 5, 3].map((h, i) => ({ Job: `J${i + 1}`, Machine: "", Hours: h })));
    const start = frame([{ Machine: "M1" }, { Machine: "M2" }]);
    const out = run(new GreedyQueueNode(), { items, start, order: lambda("Hours", "Hours"), cost: lambda("Hours", "Hours"), group: "Machine", budget: 8, steps: 1 });
    expect(rows(out.picks).map((r) => [r.Job, r.Machine, r["Used Before"]])).toEqual([["J2", "M1", 0], ["J4", "M2", 0], ["J3", "M1", 2]]);
    expect(rows(out.left).map((r) => r.Job)).toEqual(["J1"]);
  });

  it("lets Allowed pass an item over, reading the picking group's Start row as group_ names", () => {
    // Skills: a welding job only for the welder; and each machine's own hours a day.
    const items = frame([{ Job: "Weld", Needs: "weld", Hours: 3 }, { Job: "Cut", Needs: "cut", Hours: 2 }, { Job: "Cut 2", Needs: "cut", Hours: 4 }]);
    const start = frame([{ Crew: "Ann", Skills: "cut", Hours: 4 }, { Crew: "Bo", Skills: "weld cut", Hours: 6 }]);
    const can = lambda("Needs, Hours, group_Skills, group_Hours, used", "AND(NOT(ISERROR(SEARCH(Needs, group_Skills))), used + Hours <= group_Hours)");
    const out = run(new GreedyQueueNode(), { items, start, allowed: can, cost: lambda("Hours", "Hours"), group: "Crew", steps: 1, perStep: 5 });
    expect(rows(out.picks).map((r) => [r.Crew, r.Job])).toEqual([["Ann", "Cut"], ["Bo", "Weld"]]);
    expect(rows(out.left).map((r) => r.Job)).toEqual(["Cut 2"]);
  });

  it("gives each pick to the best group and item pair anywhere under Best pair first", () => {
    // Two crews at 0 and 10 on a line; jobs at 9 and 1 anyone may take; one job a crew a step, nearest first.
    const items = frame([{ Job: "far", X: 9 }, { Job: "near", X: 1 }]);
    const start = frame([{ Crew: "A", X: 0 }, { Crew: "B", X: 10 }]);
    const order = lambda("X, last_X", "ABS(X - last_X)");
    const turns = run(new GreedyQueueNode(), { items, start, order, group: "Crew", steps: 1 });
    const best = run(new GreedyQueueNode({ turns: "best" }), { items, start, order, group: "Crew", steps: 1 });
    expect(rows(turns.picks).map((r) => [r.Crew, r.Job])).toEqual([["A", "near"], ["B", "far"]]);
    expect(rows(best.picks).map((r) => [r.Crew, r.Job])).toEqual([["A", "near"], ["B", "far"]]);
    // Three jobs, B nearest to two: in turn A takes its nearest first; best pair first lets B have the one it is nearer.
    const three = frame([{ Job: "j8", X: 8 }, { Job: "j6", X: 6 }, { Job: "j2", X: 2 }]);
    const t3 = run(new GreedyQueueNode(), { items: three, start, order, group: "Crew", steps: 1 });
    const b3 = run(new GreedyQueueNode({ turns: "best" }), { items: three, start, order, group: "Crew", steps: 1 });
    expect(rows(t3.picks).map((r) => [r.Crew, r.Job])).toEqual([["A", "j2"], ["B", "j8"]]);
    expect(rows(b3.picks).map((r) => [r.Crew, r.Job])).toEqual([["A", "j2"], ["B", "j8"]]);
    expect(rows(run(new GreedyQueueNode({ turns: "best" }), { items: frame([{ Job: "j9", X: 9 }, { Job: "j7", X: 7 }]), start, order, group: "Crew", steps: 1 }).picks)
      .map((r) => [r.Crew, r.Job])).toEqual([["B", "j9"], ["A", "j7"]]);
    expect(rows(run(new GreedyQueueNode(), { items: frame([{ Job: "j9", X: 9 }, { Job: "j7", X: 7 }]), start, order, group: "Crew", steps: 1 }).picks)
      .map((r) => [r.Crew, r.Job])).toEqual([["A", "j7"], ["B", "j9"]]);
  });

  it("refuses a column it can't find, an item with no step, a score that isn't a number and a parameter it can't bind", () => {
    const items = frame([job("A", 1, 1, 0)]);
    const code = (v: unknown) => (isSolError(v) ? v.code : v);
    expect(code(run(new GreedyQueueNode(), { items, group: "Crew" }).picks)).toBe("#REF!");
    expect(code(run(new GreedyQueueNode(), { items: frame([{ Step: null as unknown as number, X: 1 }]), step: "Step" }).picks)).toBe("#VALUE!");
    expect(code(run(new GreedyQueueNode(), { items, order: lambda("Group", "Group") }).picks)).toBe("#VALUE!");
    expect(code(run(new GreedyQueueNode(), { items, order: lambda("Urgency", "Urgency") }).picks)).toBe("#VALUE!");
  });

  it("keeps its picks through a save", () => {
    const back = new GreedyQueueNode(extractInit(new GreedyQueueNode({ stepStart: "start", mode: "skip", turns: "best" })) as never);
    expect([back.stepStart, back.mode, back.turns]).toEqual(["start", "skip", "best"]);
  });
});
