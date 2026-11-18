// [[A1]] visualGraphCalculator: Assignment, Shortest Path and Pareto Front.
import { describe, it, expect } from "vitest";
import { AssignmentNode, ShortestPathNode, ParetoNode, StaffingNode } from "../../../src/graph/nodes/optimize";
import { extractInit } from "../../../src/graph/nodeInit";
import { isSolError } from "../../../src/graph/errorValue";

type Row = Record<string, unknown>;
const frame = (rows: Row[]) => {
  const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return { __frame: true, columns: names.map((name) => ({
    name, type: rows.some((r) => typeof r[name] === "number") ? "number" : "string", values: rows.map((r) => r[name] ?? null),
  })) } as never;
};
const rows = (f: unknown): Row[] => {
  const cols = (f as { columns: { name: string; values: unknown[] }[] }).columns;
  return (cols[0]?.values ?? []).map((_, i) => Object.fromEntries(cols.map((c) => [c.name, c.values[i]])));
};
const call = <T,>(n: { data: (i: Record<string, unknown[]>) => unknown }, inputs: Record<string, unknown>) =>
  n.data(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, [v]]))) as T;

describe("Assignment", () => {
  const costs = frame([{ Crew: "Ana", J1: 4, J2: 1, J3: 3 }, { Crew: "Bo", J1: 2, J2: 0, J3: 5 }, { Crew: "Cy", J1: 3, J2: 2, J3: 2 }]);
  it("pairs each row with one column for the least total, or the greatest", () => {
    const out = call<{ pairs: unknown; total: number }>(new AssignmentNode(), { costs });
    expect(rows(out.pairs).map((r) => [r.Crew, r.Assigned, r.Cost])).toEqual([["Ana", "J2", 1], ["Bo", "J1", 2], ["Cy", "J3", 2]]);
    expect(out.total).toBe(5);
    expect(call<{ total: number }>(new AssignmentNode({ goal: "max" }), { costs }).total).toBe(11);
  });
  it("never makes a blank pair, and leaves the extra rows unassigned", () => {
    const out = call<{ pairs: unknown; total: number }>(new AssignmentNode(), { costs: frame([{ Crew: "Ana", J1: 1, J2: null }, { Crew: "Bo", J1: 5, J2: null }, { Crew: "Cy", J1: null, J2: 7 }]) });
    expect(rows(out.pairs).map((r) => r.Assigned)).toEqual(["J1", null, "J2"]);
    expect(out.total).toBe(8);
  });
});

describe("Shortest Path", () => {
  const links = frame([
    { From: "Depot", To: "A", Km: 4 }, { From: "Depot", To: "B", Km: 9 }, { From: "A", To: "B", Km: 3 },
    { From: "B", To: "C", Km: 2 }, { From: "A", To: "C", Km: 8 },
  ]);
  const path = (n: ShortestPathNode, from: string, to: string, cost = "Km") => {
    n.stringLiterals = { cost, from, to };
    return call<{ path: unknown; total: unknown }>(n, { links });
  };
  it("walks the cheapest way step by step, both ways or one way", () => {
    const out = path(new ShortestPathNode(), "depot", "C");
    expect(rows(out.path).map((r) => [r.Place, r.Leg, r["So Far"]])).toEqual([["Depot", 0, 0], ["A", 4, 4], ["B", 3, 7], ["C", 2, 9]]);
    expect(out.total).toBe(9);
    expect(path(new ShortestPathNode(), "C", "Depot").total).toBe(9);
    expect(isSolError(path(new ShortestPathNode({ direction: "one" }), "C", "Depot").total)).toBe(true);
    expect(path(new ShortestPathNode(), "Depot", "C", "").total).toBe(2);
  });
  it("gives every place's distance and the place before it with no To", () => {
    const out = path(new ShortestPathNode(), "Depot", "");
    expect(rows(out.path).map((r) => [r.Place, r.Distance, r.Via])).toEqual([["Depot", 0, null], ["A", 4, "Depot"], ["B", 7, "A"], ["C", 9, "B"]]);
  });
  it("refuses an unknown place and a negative cost", () => {
    expect(isSolError(path(new ShortestPathNode(), "Nowhere", "C").path)).toBe(true);
    const neg = new ShortestPathNode();
    neg.stringLiterals = { cost: "Km", from: "A", to: "B" };
    expect(isSolError(call<{ path: unknown }>(neg, { links: frame([{ From: "A", To: "B", Km: -1 }]) }).path)).toBe(true);
  });
  it("saves its direction", () => {
    expect(extractInit(new ShortestPathNode({ direction: "one" }))).toMatchObject({ direction: "one" });
  });
});

describe("Pareto Front", () => {
  it("keeps the options nothing beats on every measure", () => {
    const options = frame([
      { Plan: "A", Hours: 2400, Response: 1.8 }, { Plan: "B", Hours: 2300, Response: 2.1 },
      { Plan: "C", Hours: 2500, Response: 2.0 }, { Plan: "D", Hours: 2200, Response: 2.6 },
    ]);
    const n = new ParetoNode();
    n.stringLiterals = { lower: "Hours, Response", higher: "" };
    const out = call<{ front: unknown; all: unknown }>(n, { options });
    expect(rows(out.front).map((r) => r.Plan)).toEqual(["A", "B", "D"]);
    expect(rows(out.all).map((r) => [r.Plan, r["On Front"], r["Beaten By"]])).toEqual([["A", true, 0], ["B", true, 0], ["C", false, 1], ["D", true, 0]]);
    n.stringLiterals = { lower: "Hours", higher: "Response" };
    expect(rows(call<{ front: unknown }>(n, { options }).front).map((r) => r.Plan)).toEqual(["D"]);
  });
});

describe("Staffing (Erlang C)", () => {
  it("gives each server count's chance of waiting and service level, and the fewest that meet the target", () => {
    // 100 calls an hour, 3 minutes each (5 erlangs), 80% answered within 20 seconds: 8 agents, as Erlang C computes.
    const n = new StaffingNode();
    const out = call<{ options: unknown; needed: number }>(n, { arrivals: 100, minutes: 3, target: 1 / 3, share: 0.8 });
    const r = rows(out.options);
    expect(r[0].Staff).toBe(6);
    expect(r.map((x) => Math.round((x["In Time"] as number) * 1e4) / 1e4).slice(0, 4)).toEqual([0.4743, 0.7404, 0.8801, 0.9484]);
    expect(Math.round((r[1]["Chance to Wait"] as number) * 1e4) / 1e4).toBe(0.3241);
    expect(out.needed).toBe(8);
    expect(r[r.length - 1].Staff).toBe(11);
  });
  it("answers nothing until both rates are set, and refuses a share of 1 or more", () => {
    expect(call<{ needed: unknown }>(new StaffingNode(), { arrivals: 100 }).needed).toBe(null);
    expect(isSolError(call<{ needed: unknown }>(new StaffingNode(), { arrivals: 100, minutes: 3, share: 1 }).needed)).toBe(true);
  });
});
