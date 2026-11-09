import { describe, it, expect } from "vitest";
import { runGraph, formulaGraph } from "./run-graph";
// @ts-expect-error a plain .mjs script, untyped
import { expand } from "./shot-graph-expand.mjs";
import type { FrameValue } from "../src/graph/frame";
import gettingStarted from "../src/graph/seedGraphs/getting-started.json";
import tableVerbs from "../src/graph/seedGraphs/table-verbs.json";

// scripts/run-graph.ts is the headless CLI (bundle 07, "in → through → out →
// unattended"): a saved graph runs outside the browser through a real editor +
// DataflowEngine, exactly like framesSeed.test.ts's pattern. This covers the
// exit criterion that it "runs a saved graph headlessly and prints outputs" —
// vitest's `node` environment has no `window`, so a pass here is proof there's
// no hidden Tauri/browser dependency.

describe("run-graph (headless CLI)", () => {
  it("runs a saved graph outside the browser and prints real values, keyed by label", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await runGraph(gettingStarted as any);
    const sales = out["Quarterly sales"] as { frame: FrameValue };
    expect(sales.frame.columns.map((c) => c.name)).toEqual(["Quarter", "Sales"]);
    expect(out["SUM"]).toEqual({ result: 1200 + 1550 + 1340 + 1810 });
  });

  it("runs Join and GROUPBY on the core, with lazy handles resolved before printing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await runGraph(tableVerbs as any);

    const grouped = (out["GROUPBY Rep → SUM(Amount)"] as { frame: FrameValue }).frame;
    const rep = grouped.columns.find((c) => c.name === "Rep")!;
    const amount = grouped.columns.find((c) => c.name === "Amount")!;
    const byRep = Object.fromEntries(rep.values.map((r, i) => [r, amount.values[i]]));
    // The seed's GROUPBY carries totalDepth 1 (B-4b) — the grand total row
    // RE-AGGREGATES the source through the no-colFields pivot path.
    expect(byRep).toEqual({ Ada: 230, Bo: 125, Cy: 200, "Grand Total": 555 });

    const joined = (out["Join Sales × Reps (left, on Rep)"] as { frame: FrameValue }).frame;
    expect(joined.columns.map((c) => c.name)).toEqual(["Rep", "Region", "Amount", "Team"]);
    const team = joined.columns.find((c) => c.name === "Team")!;
    expect(team.values).toEqual(["Red", "Blue", "Red", "Green", "Blue", "Red"]);
  });

  it("throws a clear error for an unknown node type instead of silently skipping it", async () => {
    await expect(
      runGraph({ nodes: [{ id: "x", type: "TotallyNotARealNodeType" }], connections: [] }),
    ).rejects.toThrow(/Unknown node type/);
  });

  it("throws a clear error when a connection references a node that isn't in the graph", async () => {
    await expect(
      runGraph({
        nodes: [{ id: "a", type: "ValueInputNode" }],
        connections: [{ source: "a", sourceOutput: "value", target: "missing", targetInput: "in" }],
      }),
    ).rejects.toThrow(/unknown node/);
  });

  // The short form shot-graph takes: cables as strings, the same file for a picture and for values.
  const loan = () => expand({
    nodes: [
      { id: "r", type: "ValueInputNode", init: { label: "Rate", op: "number", value: "0.05" } },
      { id: "n", type: "ValueInputNode", init: { label: "Name", op: "string", value: "Ada" } },
      { id: "p", type: "ExpressionNode", init: { label: "Payment", expr: "PMT(rate / 12, 60, 10000)" } },
      { id: "g", type: "ExpressionNode", init: { label: "Greeting", expr: '"Hi " & who' } },
    ],
    cables: ["r.value -> p.rate", "n.value -> g.who"],
  });

  it("--set types a value into the input card of that name, and --out prints only the named cards", async () => {
    const before = await runGraph(loan(), { out: ["payment"] });
    expect(Object.keys(before)).toEqual(["Payment"]);
    expect((before["Payment"] as { result: number }).result).toBeCloseTo(-188.7123364, 6);
    const after = await runGraph(loan(), { set: { rate: "0.08", Name: "Grace Hopper" }, out: ["Payment", "Greeting"] });
    expect((after["Payment"] as { result: number }).result).toBeCloseTo(-202.7639429, 6);
    expect(after["Greeting"]).toEqual({ result: "Hi Grace Hopper" });
  });

  it("--set and --out name a card that exists, once", async () => {
    await expect(runGraph(loan(), { set: { Nope: "1" } })).rejects.toThrow(/no card has that name/);
    await expect(runGraph(loan(), { set: { Payment: "1" } })).rejects.toThrow(/isn't an input card/);
    await expect(runGraph(loan(), { out: ["Nope"] })).rejects.toThrow(/no card has that name/);
  });

  it("a card answers to its document name or id before its label", async () => {
    const g = loan();
    g.nodes[2].name = "Monthly";
    const out = await runGraph(g, { set: { r: "0.08" }, out: ["monthly"] });
    expect(Object.keys(out)).toEqual(["Payment"]);
    expect((out["Payment"] as { result: number }).result).toBeCloseTo(-202.7639429, 6);
  });

  it("--formula runs one formula over the numbers --set gives its variables, errors as the app's own", async () => {
    const run = async (expr: string, set?: Record<string, string>) => (await runGraph(formulaGraph(expr, set)))["formula"] as { result: unknown };
    expect((await run("PMT(rate / 12, 60, 10000)", { rate: "0.05" })).result).toBeCloseTo(-188.7123364, 6);
    expect((await run("1/0")).result).toMatchObject({ code: "#DIV/0!" });
    expect(() => formulaGraph("x + 1", { x: "abc" })).toThrow(/takes a number/);
  });
});
