// [[A1]] visualGraphCalculator: the Local Search card's moves, its rule written as LAMBDA cards.
import { describe, it, expect } from "vitest";
import { GreedyQueueNode, LocalSearchNode } from "../../../src/graph/nodes/queue";
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
type Out = { plan: unknown; total: unknown; history: unknown };
const run = (n: LocalSearchNode, inputs: Record<string, unknown>) =>
  n.data(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, [v]]))) as Out;

const DIST = "IF(ISBLANK(last_X), 0, ABS(X - last_X) + ABS(Y - last_Y))";
const dist = lambda("X, Y, last_X, last_Y", DIST);

describe("Local Search", () => {
  it("orders jobs by one-way changeovers, matching a chosen column and reading a chosen number", () => {
    // A paint line from clean white: going darker takes 10 minutes a shade, lighter 45. Light to dark is best: 30.
    const shades = ["White", "Yellow", "Red", "Black"];
    const changeovers = frame(shades.flatMap((a, i) => shades.filter((b) => b !== a).map((b) => {
      const k = shades.indexOf(b);
      return { From: a, To: b, Cost: 99, Minutes: k > i ? 10 * (k - i) : 45 * (i - k) };
    })));
    const jobs = frame([{ Job: "J1", Color: "Black" }, { Job: "J2", Color: "White" }, { Job: "J3", Color: "Red" }, { Job: "J4", Color: "Yellow" }]);
    const line = frame([{ Job: "Start", Color: "White" }]);
    const settings = { transitionsDirection: "one" as const, transitionsMatch: "Color", transitionsOf: "Minutes", transitionsUnlisted: "none" as const };
    const out = run(new LocalSearchNode({ ...settings, stuck: "look" }), { items: jobs, start: line, transitions: changeovers });
    expect(rows(out.plan).map((r) => r.Color)).toEqual(["White", "Yellow", "Red", "Black"]);
    expect(out.total).toBe(30);
    // Read both ways, each pair costs its cheaper direction, so the plan no longer has to run light to dark.
    expect(run(new LocalSearchNode({ ...settings, transitionsDirection: "both" }), { items: jobs, start: line, transitions: changeovers }).total).toBe(30);
    // The settings save.
    expect(extractInit(new LocalSearchNode(settings))).toMatchObject(settings);
  });

  it("an unlisted pair goes through others, or is refused", () => {
    // White to Black is listed at 60, but White to Red to Black costs 20: through others takes the chain.
    const table = frame([["White", "Red", 10], ["Red", "Black", 10], ["White", "Black", 60]].map(([From, To, Minutes]) => ({ From, To, Minutes })));
    const jobs = frame([{ Color: "Black" }]);
    const line = frame([{ Color: "White" }]);
    const one = { transitionsDirection: "one" as const };
    expect(run(new LocalSearchNode(one), { items: jobs, start: line, transitions: table }).total).toBe(20);
    // Not allowed: the row as written, 60; a pair no row lists is an error naming it.
    expect(run(new LocalSearchNode({ ...one, transitionsUnlisted: "none" }), { items: jobs, start: line, transitions: table }).total).toBe(60);
    const short = frame([{ From: "White", To: "Red", Minutes: 10 }, { From: "Red", To: "Black", Minutes: 10 }]);
    expect(JSON.stringify(run(new LocalSearchNode({ ...one, transitionsUnlisted: "none" }), { items: jobs, start: line, transitions: short }).total)).toMatch(/no row from White to Black/);
  });

  it("prices each stop from a table of drive times between named places, no formula", () => {
    // A bakery van: four stops and the minutes between each pair, as a person has them. Nearest next, then improved
    // and back to the bakery: 43 minutes, the best of all 24 orders.
    const times = frame([
      ["Bakery", "School", 10], ["Bakery", "Hotel", 15], ["Bakery", "Hospital", 20], ["Bakery", "Market", 12],
      ["School", "Hotel", 8], ["School", "Hospital", 14], ["School", "Market", 9], ["Hotel", "Hospital", 6],
      ["Hotel", "Market", 11], ["Hospital", "Market", 7],
    ].map(([From, To, Minutes]) => ({ From, To, Minutes })));
    const stops = frame(["School", "Hotel", "Hospital", "Market"].map((Stop) => ({ Stop })));
    const bakery = frame([{ Stop: "Bakery" }]);
    const q = new GreedyQueueNode({ orderBy: "cost" });
    const nearest = q.data({ items: [stops], start: [bakery], transitions: [times] }) as { picks: unknown; total: unknown };
    expect(rows(nearest.picks).map((r) => r.Stop)).toEqual(["School", "Hotel", "Hospital", "Market"]);
    expect(nearest.total).toBe(31);
    const out = run(new LocalSearchNode({ ends: "return" }), { items: nearest.picks, start: bakery, transitions: times });
    expect(out.total).toBe(43);
    // Two places with no row between them cost the cheapest chain through the others: a road network serves.
    const roads = frame([["Bakery", "School", 10], ["School", "Hotel", 8], ["Hotel", "Hospital", 6], ["Hospital", "Market", 7]]
      .map(([From, To, Minutes]) => ({ From, To, Minutes })));
    const chain = run(new LocalSearchNode({ ends: "return" }), { items: stops, start: bakery, transitions: roads });
    expect(chain.total).toBe(62);
    // A place no row reaches, or one the table never names, says which.
    const cut = frame([{ From: "Bakery", To: "School", Minutes: 10 }, { From: "Hotel", To: "Hospital", Minutes: 6 }, { From: "Market", To: "Hospital", Minutes: 7 }]);
    expect(JSON.stringify(q.data({ items: [stops], start: [bakery], transitions: [cut] }).total)).toMatch(/no way from/);
    const short = frame([{ From: "Bakery", To: "School", Minutes: 10 }]);
    expect(JSON.stringify(q.data({ items: [stops], start: [bakery], transitions: [short] }).total)).toMatch(/never names/);
  });

  it("uncrosses a route, logging each change", () => {
    // The corners of a square visited crosswise: 0,0 → 1,1 → 1,0 → 0,1 is 1+2+... longer than going round.
    const items = frame([{ X: 0, Y: 0 }, { X: 10, Y: 10 }, { X: 10, Y: 0 }, { X: 0, Y: 10 }]);
    const out = run(new LocalSearchNode(), { items, cost: dist });
    expect(rows(out.history)[0]).toMatchObject({ Change: 0, Kind: "start", Total: 50 });
    expect(out.total).toBe(30);
    expect(rows(out.plan).map((r) => r.Position)).toEqual([1, 2, 3, 4]);
    expect(rows(out.plan)[3]["So Far"]).toBe(30);
  });

  it("comes back to the Start row when set to, a round trip", () => {
    const items = frame([{ X: 10, Y: 0 }, { X: 0, Y: 10 }, { X: 10, Y: 10 }]);
    const start = frame([{ X: 0, Y: 0 }]);
    const open = run(new LocalSearchNode(), { items, start, cost: dist });
    const round = run(new LocalSearchNode({ ends: "return" }), { items, start, cost: dist });
    expect(open.total).toBe(30);
    expect(round.total).toBe(40);
  });

  it("moves jobs between machines when a Penalty on lateness says to, its Cost the Hours column plus a wait read from before", () => {
    // Every job queued on M1 by a poor first plan; M2 sits empty in Start.
    const jobs = [1, 2, 3, 4].map((i) => ({ Machine: "M1", Job: `J${i}`, Ready: 0, Hours: 4, Due: 4 }));
    const items = frame(jobs);
    const start = frame([{ Machine: "M1" }, { Machine: "M2" }]);
    const cost = lambda("Ready, before", "MAX(0, Ready - before)");
    const penalty = lambda("Due, at", "MAX(0, at - Due)");
    const node = () => Object.assign(new LocalSearchNode(), { stringLiterals: { group: "", costColumn: "Hours" } });
    const out = run(node(), { items, start, cost, penalty, group: "Machine" });
    const plan = rows(out.plan);
    expect(plan.filter((r) => r.Machine === "M2")).toHaveLength(2);
    expect(out.total).toBe(16 + 8);
    const within = run(Object.assign(node(), { reach: "within" }), { items, start, cost, penalty, group: "Machine" });
    expect(within.total).toBe(16 + 0 + 4 + 8 + 12);
    expect(rows(within.history)).toHaveLength(1);
  });

  it("puts fewer refusals by Allowed first, as a truck's capacity read at at", () => {
    const items = frame([{ Truck: "T1", Kg: 600 }, { Truck: "T1", Kg: 500 }, { Truck: "T2", Kg: 300 }, { Truck: "T2", Kg: 400 }]);
    const weight = lambda("Kg", "Kg");
    const fits = lambda("at", "at <= 1000");
    const out = run(new LocalSearchNode(), { items, cost: weight, allowed: fits, group: "Truck" });
    expect(rows(out.history)[0]).toMatchObject({ "Not Allowed": 1 });
    expect(rows(out.plan).every((r) => r.Allowed === true)).toBe(true);
  });

  it("improves Greedy Queue's nearest-next route", () => {
    const pts = [[0, 0], [5, 1], [9, 0], [1, 6], [8, 7], [4, 9], [2, 2], [7, 3]].map(([X, Y]) => ({ X, Y }));
    const q = new GreedyQueueNode().data({ items: [frame(pts)], order: [dist], cost: [dist], start: [frame([{ X: 0, Y: 0 }])] }) as { picks: unknown; total: number };
    const out = run(new LocalSearchNode(), { items: q.picks, cost: dist, start: frame([{ X: 0, Y: 0 }]) });
    expect(out.total as number).toBeLessThanOrEqual(q.total);
    expect(rows(out.plan)).toHaveLength(8);
  });

  it("scores a move by its links when nothing reads before, at or position, the same as by walking", () => {
    let seed = 3;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pts = Array.from({ length: 30 }, (_, i) => ({ G: ["A", "B", "C"][i % 3], X: Math.round(r() * 100), Y: Math.round(r() * 100) }));
    const items = frame(pts);
    const start = frame([{ G: "A", X: 0, Y: 0 }, { G: "B", X: 100, Y: 0 }, { G: "C", X: 50, Y: 100 }]);
    const near = lambda("X, Y, group_X", "X <= group_X + 60");
    for (const ends of ["open", "return"] as const) {
      const links = run(new LocalSearchNode({ ends }), { items, start, cost: dist, allowed: near, group: "G" });
      const walks = run(new LocalSearchNode({ ends }), { items, start, cost: dist, allowed: near, group: "G", penalty: lambda("position", "0 * position") });
      expect(links.total as number).toBeCloseTo(walks.total as number, 9);
      expect(rows(links.plan).map((x) => [x.G, x.X])).toEqual(rows(walks.plan).map((x) => [x.G, x.X]));
      expect(rows(links.history).length).toBe(rows(walks.history).length);
    }
  });

  it("searches Thoroughly past a dead end, never ending worse than Quick and here better", () => {
    let seed = 7;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const items = frame(Array.from({ length: 60 }, () => ({ X: Math.round(r() * 1000), Y: Math.round(r() * 1000) })));
    const euclid = lambda("X, Y, last_X, last_Y", "IF(ISBLANK(last_X), 0, SQRT((X - last_X)^2 + (Y - last_Y)^2))");
    const quick = run(new LocalSearchNode(), { items, cost: euclid });
    const thorough = run(new LocalSearchNode({ stuck: "look" }), { items, cost: euclid });
    expect(thorough.total as number).toBeLessThan(quick.total as number);
    expect(rows(thorough.history).some((h) => h.Kind === "kept looking")).toBe(true);
  });

  it("refuses a Cost reading at, an unknown group column, and a parameter naming nothing", () => {
    const items = frame([{ G: "A", X: 1 }]);
    expect(isSolError(run(new LocalSearchNode(), { items, cost: lambda("at", "at") }).total)).toBe(true);
    expect(isSolError(run(new LocalSearchNode(), { items, group: "Nope" }).plan)).toBe(true);
    expect(isSolError(run(new LocalSearchNode(), { items, cost: lambda("Zed", "Zed") }).plan)).toBe(true);
  });

  it("saves its reach and ends", () => {
    const n = new LocalSearchNode({ reach: "within", ends: "return" });
    expect(extractInit(n)).toMatchObject({ reach: "within", ends: "return" });
  });
});
