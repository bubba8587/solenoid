// [[C25]] firstClassUnits: the optimization cards carry the units of the columns and values they read, refusing two
// quantities of different dimensions with #UNIT!, a plain number taking the other's unit as arithmetic does.
import { describe, it, expect } from "vitest";
import { SolverNode, AssignmentNode, ShortestPathNode, StaffingNode } from "../../../src/graph/nodes/optimize";
import { GreedyQueueNode, LocalSearchNode } from "../../../src/graph/nodes/queue";
import { isSolError } from "../../../src/graph/errorValue";
import { fromUnit, isUnitCell } from "../../../src/graph/unitValue";
import { fcUnitToUnit } from "../../../src/graph/dimension";

type Col = { name: string; type: string; values: unknown[]; unit?: unknown };
const unitOf = (id: string) => { const u = fcUnitToUnit(id)!; return { dim: u.dim, display: id }; };
const col = (name: string, values: unknown[], unit?: string): Col =>
  ({ name, type: typeof values.find((v) => v != null) === "number" ? "number" : "string", values, ...(unit ? { unit: unitOf(unit) } : {}) });
const frame = (...cols: Col[]) => ({ __frame: true, columns: cols }) as never;
const qty = (n: number, id: string) => fromUnit(n, fcUnitToUnit(id)!, id);
const call = <T,>(n: { data: (i: Record<string, unknown[]>) => unknown }, inputs: Record<string, unknown>) =>
  n.data(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, [v]]))) as T;
const display = (v: unknown) => (isUnitCell(v) ? (v as { display?: string }).display : undefined);
const colOf = (f: unknown, name: string) => (f as { columns: Col[] }).columns.find((c) => c.name === name)!;
const unitDisplay = (c: Col) => (c.unit as { display?: string } | undefined)?.display;

describe("units through the optimization cards", () => {
  it("Solver: Best in the goal's unit, a plain Limit read in its Sum of column's, a mismatched Limit refused", () => {
    const options = frame(col("Blend", ["A", "B"]), col("Profit", [6, 9], "usd"), col("Beans", [1, 1], "kg"));
    const n = new SolverNode();
    n.stringLiterals.objective = "Profit";
    const limits = (unit?: string) => frame(col("Sum of", ["Beans"]), col("Sign", ["<="]), col("Limit", [100], unit));
    const plain = call<{ best: unknown; limits: unknown }>(n, { options, limits: limits() });
    expect(display(plain.best)).toBe("usd");
    expect(unitDisplay(colOf(plain.limits, "Used"))).toBe("kg");
    const tonnes = call<{ plan: unknown }>(n, { options, limits: frame(col("Sum of", ["Beans"]), col("Sign", ["<="]), col("Limit", [0.1], "t")) });
    expect(colOf(tonnes.plan, "Amount").values).toEqual([0, 100]);
    expect(isSolError(call<{ best: unknown }>(n, { options, limits: limits("h") }).best)).toBe(true);
  });

  it("Greedy Queue: a Budget in tonnes against costs in kg, the costs and total in kg; a Budget in hours refused", () => {
    const items = frame(col("Box", ["a", "b", "c"]), col("Kg", [600, 500, 300], "kg"));
    const run = (budget: unknown) => {
      const q = new GreedyQueueNode({ mode: "skip" });
      q.stringLiterals = { group: "", step: "", orderColumn: "", costColumn: "Kg" };
      return call<{ picks: unknown; total: unknown }>(q, { items, budget });
    };
    const out = run(qty(1, "t"));
    expect(colOf(out.picks, "Picked").values).toEqual([1, 1, 2]);
    expect(unitDisplay(colOf(out.picks, "Cost"))).toBe("kg");
    expect(display(out.total)).toBe("kg");
    expect(isSolError(run(qty(8, "h")).picks)).toBe(true);
    expect(colOf(run(1000).picks, "Picked").values).toEqual([1, 1, 2]);
  });

  it("Local Search, Assignment and Shortest Path carry their cost columns' units", () => {
    const ls = new LocalSearchNode();
    ls.stringLiterals = { group: "", costColumn: "Hours" };
    expect(display(call<{ total: unknown }>(ls, { items: frame(col("Job", ["a", "b"]), col("Hours", [2, 3], "h")) }).total)).toBe("h");
    const grid = frame(col("Crew", ["N", "S"]), col("J1", [2, 3], "h"), col("J2", [60, 120], "min"));
    const pairs = call<{ pairs: unknown; total: unknown }>(new AssignmentNode(), { costs: grid });
    expect(display(pairs.total)).toBe("h");
    expect(colOf(pairs.pairs, "Cost").values).toEqual([1, 3]);
    expect(isSolError(call<{ total: unknown }>(new AssignmentNode(), { costs: frame(col("Crew", ["N"]), col("J1", [2], "h"), col("J2", [5], "km")) }).total)).toBe(true);
    const sp = new ShortestPathNode();
    sp.stringLiterals = { cost: "Minutes", from: "A", to: "B" };
    expect(display(call<{ total: unknown }>(sp, { links: frame(col("From", ["A"]), col("To", ["B"]), col("Minutes", [12], "min")) }).total)).toBe("min");
  });

  it("Staffing reads a time in minutes and a rate an hour, and refuses a length", () => {
    const out = call<{ needed: number; options: unknown }>(new StaffingNode(), { arrivals: qty(100, "1/h"), minutes: qty(3, "min"), target: qty(20, "s"), share: 0.8 });
    expect(out.needed).toBe(8);
    expect(unitDisplay(colOf(out.options, "Mean Wait"))).toBe("min");
    expect(isSolError(call<{ needed: unknown }>(new StaffingNode(), { arrivals: 100, minutes: qty(3, "km") }).needed)).toBe(true);
  });
});
