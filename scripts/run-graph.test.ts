import { describe, it, expect } from "vitest";
import { runGraph } from "./run-graph";
import { isFrameValue, type FrameValue } from "../src/graph/frame";
import gettingStarted from "../src/graph/seedGraphs/getting-started.json";
import tableVerbs from "../src/graph/seedGraphs/table-verbs.json";

// scripts/run-graph.ts is the headless CLI (bundle 07, "in → through → out →
// unattended"): a saved graph runs outside the browser through a real editor +
// DataflowEngine, exactly like framesSeed.test.ts's pattern. This covers the
// exit criterion that it "runs a saved graph headlessly and prints outputs,
// confirmed to route Polars-backed nodes through the JS oracle correctly" —
// vitest's `node` environment has no `window`, so a pass here is proof there's
// no hidden Tauri/browser dependency.

describe("run-graph (headless CLI)", () => {
  it("has no browser/Tauri globals available — genuinely headless, not jsdom", () => {
    expect(typeof window).toBe("undefined");
  });

  it("runs a saved graph outside the browser and prints real values, keyed by label", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await runGraph(gettingStarted as any);
    const sales = out["Quarterly sales"] as { frame: FrameValue };
    expect(isFrameValue(sales.frame)).toBe(true);
    expect(sales.frame.columns.map((c) => c.name)).toEqual(["Quarter", "Sales"]);
    expect(out["SUM"]).toEqual({ result: 1200 + 1550 + 1340 + 1810 });
  });

  it("routes Join and Group By (Polars-backed on desktop) through the JS oracle correctly, with lazy handles resolved before printing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await runGraph(tableVerbs as any);

    const grouped = (out["Group By Rep → SUM(Amount)"] as { frame: FrameValue }).frame;
    expect(isFrameValue(grouped)).toBe(true); // not a "jsf:N" ref string — actually materialized
    const rep = grouped.columns.find((c) => c.name === "Rep")!;
    const amount = grouped.columns.find((c) => c.name === "Amount")!;
    const byRep = Object.fromEntries(rep.values.map((r, i) => [r, amount.values[i]]));
    // The seed's Group By carries totalDepth 1 (B-4b) — the grand total row
    // RE-AGGREGATES the source through the no-colFields pivot path.
    expect(byRep).toEqual({ Ada: 230, Bo: 125, Cy: 200, "Grand Total": 555 });

    const joined = (out["Join Sales × Reps (left, on Rep)"] as { frame: FrameValue }).frame;
    expect(isFrameValue(joined)).toBe(true);
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
        nodes: [{ id: "a", type: "NumberInputNode" }],
        connections: [{ source: "a", sourceOutput: "value", target: "missing", targetInput: "in" }],
      }),
    ).rejects.toThrow(/unknown node/);
  });
});
