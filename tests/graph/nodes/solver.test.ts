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

  it("searches when the formula reads the plan's totals: a price that falls as total output rises", () => {
    // Each unit sells at its Price less 0.01 for every unit made in all: the best is 500 of the dearer one, 2500.
    const goods = frame([{ Good: "A", Price: 10 }, { Good: "B", Price: 8 }]);
    const market = lambda("Price, amount, total_amount", "Price * amount - 0.01 * amount * total_amount");
    const { n, out } = solve(goods, [{ of: "", sign: "le", limit: 1000 }], "", "max", market);
    const [a, b] = rows(out.plan).map((r) => r.Amount as number);
    expect(a).toBeCloseTo(500, 2);
    expect(b).toBeCloseTo(0, 4);
    expect(out.best as number).toBeCloseTo(2500, 4);
    expect(n.cachedStatus).toMatch(/starting plans/);
  });

  it("holds a blend's weighted average and a share of it", () => {
    // Two beans, 12% and 4% fat, 3 and 5 a kg: the cheapest 100 kg averaging at most 6% fat is 25 kg and 75 kg.
    const beans = frame([{ Bean: "Rich", Fat: 0.12, Cost: 3 }, { Bean: "Lean", Fat: 0.04, Cost: 5 }]);
    const avg: SolverLimit[] = [{ of: "", sign: "eq", limit: 100 }, { measure: "average", of: "Fat", sign: "le", limit: 0.06 }];
    const blend = solve(beans, avg, "Cost", "min");
    expect(rows(blend.out.plan).map((r) => r.Amount)).toEqual([25, 75]);
    expect(rows(blend.out.limits)[1]).toMatchObject({ Limit: "Average Fat", "Must Be": "at most", Bound: 0.06, Used: 0.06, Slack: 0, "Shadow Price": null });
    // Rich must be at least 40% of the kilos: 40 and 60.
    const share = solve(beans, [{ of: "", sign: "eq", limit: 100 }, { measure: "share", of: "", where: "Bean", is: "Rich", sign: "ge", limit: 0.4 }], "Cost", "max");
    expect(rows(share.out.plan).map((r) => r.Amount)).toEqual([40, 60]);
    expect(rows(share.out.limits)[1]).toMatchObject({ Used: 0.4, Slack: 0 });
    const least = solve(beans, [{ of: "", sign: "eq", limit: 100 }, { measure: "share", of: "", where: "Bean", is: "Rich", sign: "ge", limit: 0.4 }], "Cost", "min");
    expect(rows(least.out.plan).map((r) => r.Amount)).toEqual([100, 0]);
    expect(rows(least.out.limits)[1]).toMatchObject({ Limit: "Share of Amount where Bean is Rich", Used: 1 });
  });

  it("repeats a limit for each group, its number from a column: a transport plan by supply and demand", () => {
    const routes = [["A", "X", 4, 30, 25], ["A", "Y", 6, 30, 20], ["B", "X", 5, 30, 25], ["B", "Y", 3, 30, 20]]
      .map(([From, To, Cost, Supply, Demand]) => ({ From, To, Cost, Supply, Demand }));
    const limits: SolverLimit[] = [
      { of: "", by: "From", sign: "le", limit: null, limitColumn: "Supply" },
      { of: "", by: "To", sign: "ge", limit: null, limitColumn: "Demand" },
    ];
    const { out } = solve(frame(routes), limits, "Cost", "min");
    expect(rows(out.plan).map((r) => r.Amount)).toEqual([25, 0, 0, 20]);
    expect(out.best).toBe(160);
    expect(rows(out.limits).map((r) => r.Limit)).toEqual(["Total Amount for From A", "Total Amount for From B", "Total Amount for To X", "Total Amount for To Y"]);
    // A column that differs within a group can't be one limit.
    const mixed = routes.map((r, i) => ({ ...r, Supply: 30 + i }));
    expect(isSolError(solve(frame(mixed), limits, "Cost", "min").out.best)).toBe(true);
  });

  it("counts the options used, holds each option to its own column, and balances a goal across groups", () => {
    const suppliers = frame([
      { Name: "P", Price: 3, Cap: 40 }, { Name: "Q", Price: 4, Cap: 60 }, { Name: "R", Price: 5, Cap: 80 },
    ]);
    const need: SolverLimit = { of: "", sign: "ge", limit: 100 };
    const own: SolverLimit = { measure: "each", of: "", sign: "le", limit: null, limitColumn: "Cap" };
    const free = solve(suppliers, [need, own], "Price", "min");
    expect(rows(free.out.plan).map((r) => r.Amount)).toEqual([40, 60, 0]);
    expect(rows(free.out.limits).map((r) => r.Limit)).toEqual(["Total Amount", "Amount of P", "Amount of Q", "Amount of R"]);
    // At most one supplier, none of which can carry 100 alone: no plan.
    expect(isSolError(solve(suppliers, [need, own, { measure: "used", of: "", sign: "le", limit: 1 }], "Price", "min").out.best)).toBe(true);
    // R can, once its Max allows it.
    const capped = solve(frame([{ Name: "P", Price: 3, Max: 40 }, { Name: "Q", Price: 4, Max: 60 }, { Name: "R", Price: 5, Max: 120 }]),
      [need, { measure: "used", of: "", sign: "le", limit: 1 }], "Price", "min");
    expect(rows(capped.out.plan).map((r) => r.Amount)).toEqual([0, 0, 100]);
    expect(rows(capped.out.limits)[1]).toMatchObject({ Limit: "Number used", Used: 1 });
    // Six jobs on two machines, hours 5 4 3 3 2 1: balanced, each machine runs 9.
    const jobs = frame(["5", "4", "3", "3b", "2", "1"].flatMap((j) => ["M1", "M2"].map((m) => ({ Job: j, Machine: m, Hours: Number.parseFloat(j), Max: 1, Whole: true }))));
    const n = new SolverNode({ goal: "min", limitList: [{ of: "", by: "Job", sign: "eq", limit: 1 }] });
    n.stringLiterals.objective = "Hours";
    n.stringLiterals.balance = "Machine";
    const balanced = n.data({ options: [jobs] }) as Out;
    expect(balanced.best).toBe(9);
  });

  it("keeps an option at 0 or at least its Min If Used", () => {
    const lots = frame([{ Lot: "A", Cost: 2, "Min If Used": 50, Max: 200 }, { Lot: "B", Cost: 3, "Min If Used": 0, Max: 200 }]);
    const { out } = solve(lots, [{ of: "", sign: "ge", limit: 30 }], "Cost", "min");
    // 30 from A would break its minimum of 50; 50 from A costs 100, 30 from B 90.
    expect(rows(out.plan).map((r) => r.Amount)).toEqual([0, 30]);
    const more = solve(lots, [{ of: "", sign: "ge", limit: 48 }], "Cost", "min");
    expect(rows(more.out.plan).map((r) => r.Amount)).toEqual([50, 0]);
  });

  it("a switch that counts an option unused leaves it at 0, however far the option could reach", () => {
    // The relaxation can set a switch to 1e-7 and pass a whole number's check while a reach of 10 million lets 1
    // through: Number used must still hold.
    const opts = frame([
      { Name: "A", Gain: 1, Fat: 10, G: 1, Max: null }, { Name: "B", Gain: 1, Fat: 10, G: 2, Max: null },
      { Name: "C1", Gain: 0, Fat: 0, G: 1, Max: 1 }, { Name: "C2", Gain: 0, Fat: 0, G: 2, Max: 1 },
    ]);
    const limits: SolverLimit[] = [
      { of: "", sign: "le", limit: 1e7 },
      { measure: "average", of: "Fat", where: "G", is: "1", sign: "le", limit: 5 },
      { measure: "average", of: "Fat", where: "G", is: "2", sign: "le", limit: 5 },
      { measure: "used", of: "", where: "Fat", is: "10", sign: "le", limit: 1 },
    ];
    const { out } = solve(opts, limits, "Gain");
    expect(out.best).toBe(1);
    expect(rows(out.limits)[3]).toMatchObject({ Used: 1 });
    // Min If Used: 1 of A can't slip under its minimum of 50 the same way.
    const lots = frame([{ Name: "A", Gain: 1, Fat: 10, "Min If Used": 50, Max: null }, { Name: "B", Gain: 0, Fat: 0, "Min If Used": 0, Max: 1 }]);
    const min = solve(lots, [{ of: "", sign: "le", limit: 1e7 }, { measure: "average", of: "Fat", sign: "le", limit: 5 }], "Gain");
    expect(rows(min.out.plan).map((r) => r.Amount)).toEqual([0, 0]);
  });

  it("a setup fee is paid only where a supplier is used, found exactly and quickly", () => {
    // 1,000 parts: X $2 + $300 setup up to 700, Y $2.40 up to 800, Z $1.80 + $500 setup, 400 to 600. Best: 700 X, 300 Y.
    // A switch on every piece once any formula kinked took 20,000 branches and 29 s to stop short at $2,437.50.
    const suppliers = frame([
      { Supplier: "X", Price: 2, Setup: 300, Max: 700, "Min If Used": 0 },
      { Supplier: "Y", Price: 2.4, Setup: 0, Max: 800, "Min If Used": 0 },
      { Supplier: "Z", Price: 1.8, Setup: 500, Max: 600, "Min If Used": 400 },
    ]);
    const fee = lambda("Price, Setup, amount", "IF(amount > 0, Setup, 0) + Price * amount");
    const { n, out } = solve(suppliers, [{ of: "", sign: "ge", limit: 1000 }], "", "min", fee);
    expect(rows(out.plan).map((r) => r.Amount)).toEqual([700, 300, 0]);
    expect(out.best).toBe(2420);
    expect(n.cachedStatus).not.toMatch(/stopped/);
  });

  it("a Min If Used option's Min is 0 for every other option's reach too", () => {
    const opts = frame([{ Name: "A", Gain: 1, Min: 10, "Min If Used": 10 }, { Name: "B", Gain: 2, "Min If Used": 1 }]);
    const { out } = solve(opts, [{ of: "", sign: "le", limit: 20 }], "Gain");
    expect(rows(out.plan).map((r) => r.Amount)).toEqual([0, 20]);
    expect(out.best).toBe(40);
    const alone = solve(frame([{ Name: "A", Gain: 1, Min: 10, "Min If Used": 10 }]), [{ of: "", sign: "le", limit: 5 }], "Gain");
    expect(rows(alone.out.plan).map((r) => r.Amount)).toEqual([0]);
  });

  it("refuses a negative amount where a count, an average or a share needs amounts from 0", () => {
    const opts = frame([{ Name: "A", Gain: -1, Min: -10, Max: 10, Fat: 1 }]);
    expect(solve(opts, [], "Gain").out.best).toBe(10);
    const used = solve(opts, [{ measure: "used", of: "", sign: "le", limit: 2 }], "Gain");
    expect(JSON.stringify(used.out.best)).toMatch(/Min below 0/);
    const avg = solve(opts, [{ measure: "average", of: "Fat", sign: "le", limit: 2 }], "Gain");
    expect(JSON.stringify(avg.out.best)).toMatch(/Min below 0/);
  });

  it("refuses a goal formula too large for the engine instead of stopping it", () => {
    // A thousand options each read at 17 points: tens of thousands of bounded pieces, past the tableau's limit.
    const many = frame(Array.from({ length: 1000 }, (_, i) => ({ Item: `I${i}`, P: 1 + (i % 7), Max: 10 })));
    const { out } = solve(many, [{ of: "", sign: "le", limit: 500 }], "", "max", lambda("P, amount", "P * amount - 0.05 * amount ^ 2"));
    expect(JSON.stringify(out.best)).toMatch(/Too large/);
  });

  it("searches without reading a formula past an option's range", () => {
    // SQRT exists only from 0: the search's slopes are read one-sided at a bound.
    const goods = frame([{ Good: "A", Max: 100 }, { Good: "B", Max: 100 }]);
    const f = lambda("amount, total_amount", "SQRT(amount) * (20 - 0.01 * total_amount)");
    const { out } = solve(goods, [], "", "max", f);
    expect(isSolError(out.best)).toBe(false);
    expect(out.best as number).toBeGreaterThan(0);
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
