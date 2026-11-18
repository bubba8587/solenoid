// [[A1]] visualGraphCalculator: the Solver card, a linear or whole-number program from an Options and a Limits table.
import { describe, it, expect } from "vitest";
import { SolverNode } from "../../../src/graph/nodes/optimize";
import { extractInit } from "../../../src/graph/nodeInit";
import { isSolError } from "../../../src/graph/errorValue";

type Row = Record<string, unknown>;
const frame = (rows: Row[]) => {
  const names = Object.keys(rows[0]);
  return { __frame: true, columns: names.map((name) => ({
    name, type: rows.some((r) => typeof r[name] === "number") ? "number" : typeof rows[0][name] === "boolean" ? "logical" : "string",
    values: rows.map((r) => r[name] ?? null),
  })) } as never;
};
const rows = (f: unknown): Row[] => {
  const cols = (f as { columns: { name: string; values: unknown[] }[] }).columns;
  return (cols[0]?.values ?? []).map((_, i) => Object.fromEntries(cols.map((c) => [c.name, c.values[i]])));
};
type Out = { plan: unknown; best: unknown; limits: unknown };
const solve = (inputs: Record<string, unknown>, goalColumn: string, goal: "max" | "min" = "max") => {
  const n = new SolverNode({ goal });
  n.stringLiterals.objective = goalColumn;
  return { n, out: n.data(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, [v]]))) as Out };
};

describe("Solver", () => {
  it("finds a product mix and each limit's slack and shadow price", () => {
    // Hillier & Lieberman's Wyndor: 3 doors, 5 windows a batch; plant hours 4, 12, 18.
    const options = frame([{ Product: "Doors", Profit: 3, P1: 1, P2: 0, P3: 3 }, { Product: "Windows", Profit: 5, P1: 0, P2: 2, P3: 2 }]);
    const limits = frame([{ "Sum of": "P1", Sign: "<=", Limit: 4 }, { "Sum of": "P2", Sign: "<=", Limit: 12 }, { "Sum of": "P3", Sign: "<=", Limit: 18 }]);
    const { n, out } = solve({ options, limits }, "Profit");
    expect(rows(out.plan).map((r) => r.Amount)).toEqual([2, 6]);
    expect(out.best).toBe(36);
    expect(rows(out.limits).map((r) => [r.Used, r.Slack, r["Shadow Price"]])).toEqual([[2, 2, 0], [12, 0, 1.5], [18, 0, 1]]);
    expect(n.cachedStatus).toBe("Optimal");
  });

  it("reads Where and Is as SUMIFS does: a transport plan at least cost", () => {
    const routes = [["A", "X", 4], ["A", "Y", 6], ["B", "X", 5], ["B", "Y", 3]].map(([From, To, Cost]) => ({ From, To, Cost }));
    const limits = frame([
      { "Sum of": "", Where: "From", Is: "A", Sign: "<=", Limit: 30 },
      { "Sum of": "", Where: "From", Is: "B", Sign: "<=", Limit: 30 },
      { "Sum of": "", Where: "To", Is: "X", Sign: ">=", Limit: 25 },
      { "Sum of": "", Where: "To", Is: "Y", Sign: ">=", Limit: 20 },
    ]);
    const { out } = solve({ options: frame(routes), limits }, "Cost", "min");
    expect(rows(out.plan).map((r) => r.Amount)).toEqual([25, 0, 0, 20]);
    expect(out.best).toBe(160);
  });

  it("keeps Whole options to whole numbers, Max bounding each: the best set of projects in a budget", () => {
    const projects = frame([
      { Project: "A", Value: 10, Cost: 5, Max: 1, Whole: true }, { Project: "B", Value: 13, Cost: 7, Max: 1, Whole: true },
      { Project: "C", Value: 7, Cost: 4, Max: 1, Whole: true }, { Project: "D", Value: 8, Cost: 3, Max: 1, Whole: true },
    ]);
    const { out } = solve({ options: projects, limits: frame([{ "Sum of": "Cost", Sign: "at most", Limit: 10 }]) }, "Value");
    expect(rows(out.plan).map((r) => r.Amount)).toEqual([0, 1, 0, 1]);
    expect(out.best).toBe(21);
    expect(rows(out.limits)[0]["Shadow Price"]).toBe(null);
  });

  it("says when no plan fits, when the goal is unbounded, and when a table is misread", () => {
    const options = frame([{ Item: "x", Gain: 1 }]);
    const err = (o: Out) => isSolError(o.best);
    expect(err(solve({ options, limits: frame([{ "Sum of": "", Sign: ">=", Limit: 2 }, { "Sum of": "", Sign: "<=", Limit: 1 }]) }, "Gain").out)).toBe(true);
    expect(err(solve({ options }, "Gain").out)).toBe(true);
    expect(err(solve({ options, limits: frame([{ "Sum of": "Nope", Sign: "<=", Limit: 1 }]) }, "Gain").out)).toBe(true);
    expect(err(solve({ options, limits: frame([{ "Sum of": "", Sign: "around", Limit: 1 }]) }, "Gain").out)).toBe(true);
    expect(err(solve({ options }, "Missing").out)).toBe(true);
  });

  it("saves its goal", () => {
    expect(extractInit(new SolverNode({ goal: "min" }))).toMatchObject({ goal: "min" });
  });
});
