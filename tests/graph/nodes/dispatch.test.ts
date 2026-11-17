// [[A1]] visualGraphCalculator: the Dispatch Queue card's day-by-day queue.
import { describe, it, expect } from "vitest";
import { DispatchNode } from "../../../src/graph/nodes/dispatch";
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
const run = (n: DispatchNode, inputs: Record<string, unknown>) =>
  n.data(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, [v]]))) as { jobs: unknown; open: unknown };

const A = (day: number, sev: number, lat: number, svc = 60) => ({ Operator: "A", Day: day, Severity: sev, Svc: svc, Latitude: lat, Longitude: -97 });
const START = frame([{ Operator: "A", Lat: 30, Lon: -97 }]);

describe("Dispatch Queue", () => {
  it("serves one a day by default: highest priority, then the oldest, then the nearest; the rest wait", () => {
    const n = new DispatchNode();
    const out = run(n, { incidents: frame([A(1, 2, 30), A(1, 5, 31), A(1, 5, 30.1), A(3, 1, 30)]), start: START, priority: "Severity", days: 3 });
    expect(rows(out.jobs).map((r) => [r.Latitude, r.Served, r.Wait])).toEqual([[30.1, 1, 0], [31, 2, 1], [30, 3, 2]]);
    expect(rows(out.open).map((r) => r.Day)).toEqual([3]);
    expect(rows(out.jobs)[0].Km).toBeCloseTo(11.12, 1);
  });

  it("fits jobs into Hours a day by drive and service time, the day's first always", () => {
    const n = new DispatchNode();
    const out = run(n, { incidents: frame([A(1, 1, 30), A(1, 5, 30.5), A(1, 3, 30.2), A(1, 2, 30.1)]), start: START, priority: "Severity", service: "Svc", hours: 3 });
    const jobs = rows(out.jobs);
    expect(jobs.map((r) => r.Severity)).toEqual([5]);
    expect(jobs[0]["Start Min"]).toBeCloseTo(jobs[0]["Drive Min"] as number, 6);
    expect(rows(out.open)).toHaveLength(3);
  });

  it("picks the nearest under Nearest first, and goes home each night when the day starts from the start", () => {
    const n = new DispatchNode({ mode: "nearest", dayStart: "start" });
    const out = run(n, { incidents: frame([A(1, 1, 30), A(1, 5, 30.5), A(1, 3, 30.2), A(1, 2, 30.1)]), start: START, service: "Svc", hours: 3 });
    const jobs = rows(out.jobs);
    expect(jobs.map((r) => r.Latitude)).toEqual([30, 30.1]);
    expect(jobs[0]["Back Km"]).toBeNull();
    expect(jobs[1]["Back Km"]).toBeCloseTo(11.12, 1);
  });

  it("refuses an incident with no crew, day or place, and a column it can't find", () => {
    const bad = run(new DispatchNode(), { incidents: frame([{ Operator: "A", Day: null as unknown as number, Latitude: 30, Longitude: -97 }]) }).jobs;
    expect(isSolError(bad) && bad.code).toBe("#VALUE!");
    const ref = run(new DispatchNode(), { incidents: frame([A(1, 1, 30)]), priority: "Urgency" }).jobs;
    expect(isSolError(ref) && ref.code).toBe("#REF!");
  });

  it("keeps its rule and day start through a save", () => {
    const n = new DispatchNode({ mode: "oldest", dayStart: "start" });
    const back = new DispatchNode(extractInit(n) as never);
    expect([back.mode, back.dayStart]).toEqual(["oldest", "start"]);
    expect(new DispatchNode({ mode: "bogus" as never }).mode).toBe("priority");
  });
});
