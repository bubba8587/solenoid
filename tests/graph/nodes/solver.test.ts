// [[A1]] visualGraphCalculator: the Solver card, a linear or whole-number program from an Options table and its saved limits.
import { describe, it, expect } from "vitest";
import { SolverNode, type SolverLimit } from "../../../src/graph/nodes/optimize";
import { extractInit } from "../../../src/graph/nodeInit";
import { LambdaNode } from "../../../src/graph/nodes/lambda";
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
const lambda = (params: string, expr: string) => new LambdaNode({ params, expr }).data({}).result;
const solve = (options: unknown, limitList: SolverLimit[], goalColumn: string, goal: "max" | "min" = "max", goalFormula?: unknown) => {
  const n = new SolverNode({ goal, limitList });
  const inputs = goalFormula ? { options, goalFormula } : { options };
  n.stringLiterals.objective = goalColumn;
  return { n, out: n.data(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, [v]]))) as Out };
};

describe("Solver", () => {
  it("finds a product mix and each limit's slack and shadow price", () => {
    // Hillier & Lieberman's Wyndor: 3 doors, 5 windows a batch; plant hours 4, 12, 18.
    const options = frame([{ Product: "Doors", Profit: 3, P1: 1, P2: 0, P3: 3 }, { Product: "Windows", Profit: 5, P1: 0, P2: 2, P3: 2 }]);
    const limits: SolverLimit[] = [{ of: "P1", sign: "le", limit: 4 }, { of: "P2", sign: "le", limit: 12 }, { of: "P3", sign: "le", limit: 18 }];
    const { n, out } = solve(options, limits, "Profit");
    expect(rows(out.plan).map((r) => r.Amount)).toEqual([2, 6]);
    expect(out.best).toBe(36);
    expect(rows(out.limits).map((r) => [r.Used, r.Slack, r["Shadow Price"]])).toEqual([[2, 2, 0], [12, 0, 1.5], [18, 0, 1]]);
    expect(n.cachedStatus).toBe("Optimal");
  });

  it("counts only the options where a column is a value, as SUMIFS does: a transport plan at least cost", () => {
    const routes = [["A", "X", 4], ["A", "Y", 6], ["B", "X", 5], ["B", "Y", 3]].map(([From, To, Cost]) => ({ From, To, Cost }));
    const limits: SolverLimit[] = [
      { of: "", where: "From", is: "A", sign: "le", limit: 30 },
      { of: "", where: "From", is: "B", sign: "le", limit: 30 },
      { of: "", where: "To", is: "X", sign: "ge", limit: 25 },
      { of: "", where: "To", is: "Y", sign: "ge", limit: 20 },
    ];
    const { out } = solve(frame(routes), limits, "Cost", "min");
    expect(rows(out.plan).map((r) => r.Amount)).toEqual([25, 0, 0, 20]);
    expect(out.best).toBe(160);
  });

  it("keeps Whole options to whole numbers, Max bounding each: the best set of projects in a budget", () => {
    const projects = frame([
      { Project: "A", Value: 10, Cost: 5, Max: 1, Whole: true }, { Project: "B", Value: 13, Cost: 7, Max: 1, Whole: true },
      { Project: "C", Value: 7, Cost: 4, Max: 1, Whole: true }, { Project: "D", Value: 8, Cost: 3, Max: 1, Whole: true },
    ]);
    const { out } = solve(projects, [{ of: "Cost", sign: "le", limit: 10 }], "Value");
    expect(rows(out.plan).map((r) => r.Amount)).toEqual([0, 1, 0, 1]);
    expect(out.best).toBe(21);
    expect(rows(out.limits)[0]["Shadow Price"]).toBe(null);
  });

  it("totals a goal formula over each option's amount: diminishing returns share the beans", () => {
    // Revenue Price × amount − 0.05 × amount²: the best split of 100 kg makes each blend's next kg earn the same.
    const options = frame([{ Blend: "A", Price: 10, Beans: 1 }, { Blend: "B", Price: 12, Beans: 1 }]);
    const curve = lambda("Price, amount", "Price * amount - 0.05 * amount ^ 2");
    const even = solve(frame([{ Blend: "A", Price: 10, Beans: 1 }, { Blend: "B", Price: 10, Beans: 1 }]), [{ of: "Beans", sign: "le", limit: 100 }], "", "max", curve);
    expect(rows(even.out.plan).map((r) => r.Amount)).toEqual([50, 50]);
    expect(even.out.best).toBe(750);
    expect(even.n.cachedStatus).toBe("Optimal");
    const { out } = solve(options, [{ of: "Beans", sign: "le", limit: 100 }], "", "max", curve);
    const [a, b] = rows(out.plan).map((r) => r.Amount as number);
    expect(a + b).toBeCloseTo(100, 6);
    expect(Math.abs(a - 40)).toBeLessThan(0.1);
    expect(out.best as number).toBeCloseTo(860, 3);
  });

  it("finds the best plan when the formula jumps: a setup cost and a bulk discount", () => {
    // B earns 9 a kg less a 200 setup once it runs at all; A earns 5 a kg. All 100 kg go to B.
    const options = frame([{ Blend: "A", Profit: 5, Beans: 1 }, { Blend: "B", Profit: 0, Beans: 1 }]);
    const setup = lambda("Blend, amount", 'IF(AND(Blend = "B", amount > 0), 9 * amount - 200, 0)');
    const made = solve(options, [{ of: "Beans", sign: "le", limit: 100 }], "Profit", "max", setup);
    expect(rows(made.out.plan).map((r) => r.Amount)).toEqual([0, 100]);
    expect(made.out.best).toBe(700);
    expect(made.n.cachedStatus).toMatch(/searched in steps/);
    // 10 a unit, 8 past the first 50: buying 80 from one supplier beats splitting it, 740 against 800.
    const suppliers = frame([{ Supplier: "North", Units: 1 }, { Supplier: "South", Units: 1 }]);
    const tiered = lambda("amount", "IF(amount <= 50, 10 * amount, 500 + 8 * (amount - 50))");
    const bought = solve(suppliers, [{ of: "Units", sign: "ge", limit: 80 }, { of: "Units", sign: "le", limit: 200 }], "", "min", tiered);
    expect(rows(bought.out.plan).map((r) => r.Amount).sort()).toEqual([0, 80]);
    expect(bought.out.best).toBe(740);
  });

  it("asks for a range when nothing limits an option a goal formula reads", () => {
    const { out } = solve(frame([{ Item: "x", Gain: 1 }]), [], "", "max", lambda("amount", "amount"));
    expect(isSolError(out.best)).toBe(true);
    expect(JSON.stringify(out.best)).toMatch(/give it a Max/);
  });

  it("says when no plan fits, when the goal is unbounded, and when a limit is misread", () => {
    const options = frame([{ Item: "x", Gain: 1 }]);
    const err = (o: Out) => isSolError(o.best);
    expect(err(solve(options, [{ of: "", sign: "ge", limit: 2 }, { of: "", sign: "le", limit: 1 }], "Gain").out)).toBe(true);
    expect(err(solve(options, [], "Gain").out)).toBe(true);
    expect(err(solve(options, [{ of: "Nope", sign: "le", limit: 1 }], "Gain").out)).toBe(true);
    expect(err(solve(options, [{ of: "", sign: "le", limit: null }], "Gain").out)).toBe(true);
    expect(err(solve(options, [], "Missing").out)).toBe(true);
  });

  it("saves its goal and limits, each a copy", () => {
    const limitList: SolverLimit[] = [{ of: "Cost", sign: "le", limit: 10 }];
    const init = extractInit(new SolverNode({ goal: "min", limitList }));
    expect(init).toMatchObject({ goal: "min", limitList });
    expect((init.limitList as SolverLimit[])[0]).not.toBe(limitList[0]);
  });
});
