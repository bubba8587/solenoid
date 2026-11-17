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
  it("picks the lowest score each step and keeps the rest waiting; unwired, the first in line", () => {
    const items = frame([job("A", 1, 2, 0), job("A", 1, 5, 9), job("A", 1, 5, 1), job("B", 2, 1, 4), job("A", 3, 1, 0)]);
    const score = lambda("Priority, X, last_X", `-Priority * 1000 + ${DIST}`);
    const start = frame([{ Group: "A", X: 0 }]);
    const out = run(new GreedyQueueNode(), { items, start, score, group: "Group", step: "Step", steps: 3 });
    expect(rows(out.picks).map((r) => [r.Group, r.X, r.Picked, r.Wait])).toEqual([["A", 1, 1, 0], ["A", 9, 2, 1], ["B", 4, 2, 0], ["A", 0, 3, 2]]);
    expect(rows(out.left).map((r) => r.Step)).toEqual([3]);
    const fifo = run(new GreedyQueueNode(), { items, group: "Group", step: "Step", steps: 3 });
    expect(rows(fifo.picks).filter((r) => r.Group === "A").map((r) => r.X)).toEqual([0, 9, 1]);
  });

  it("spends a budget a step by the Cost formula, the step's first pick always", () => {
    const items = frame([job("A", 1, 1, 0, 2), job("A", 1, 1, 1, 2), job("A", 1, 1, 2, 2), job("A", 1, 1, 3, 2)]);
    const cost = lambda("Hours, X, last_X", `Hours + ${DIST}`);
    const out = run(new GreedyQueueNode(), { items, cost, budget: 6 });
    expect(rows(out.picks).map((r) => [r.X, r.Cost, r["Used Before"]])).toEqual([[0, 2, 0], [1, 3, 2]]);
    expect(rows(out.left)).toHaveLength(2);
    const big = run(new GreedyQueueNode(), { items: frame([job("A", 1, 1, 0, 9)]), cost, budget: 6 });
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

  it("refuses a column it can't find, an item with no step, a score that isn't a number and a parameter it can't bind", () => {
    const items = frame([job("A", 1, 1, 0)]);
    const code = (v: unknown) => (isSolError(v) ? v.code : v);
    expect(code(run(new GreedyQueueNode(), { items, group: "Crew" }).picks)).toBe("#REF!");
    expect(code(run(new GreedyQueueNode(), { items: frame([{ Step: null as unknown as number, X: 1 }]), step: "Step" }).picks)).toBe("#VALUE!");
    expect(code(run(new GreedyQueueNode(), { items, score: lambda("Group", "Group") }).picks)).toBe("#VALUE!");
    expect(code(run(new GreedyQueueNode(), { items, score: lambda("Urgency", "Urgency") }).picks)).toBe("#VALUE!");
  });

  it("keeps its step start through a save", () => {
    const back = new GreedyQueueNode(extractInit(new GreedyQueueNode({ stepStart: "start" })) as never);
    expect(back.stepStart).toBe("start");
  });
});
