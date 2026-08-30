// The demo model behind the `demo` key: each stage's rewrite must be exactly
// what a good real reply would be — validator-clean, correctly wired, placed
// on the canvas — because it flows through the production pipeline unchanged.
// The staged build is executed headlessly to the real numbers, not just parsed.

import { describe, it, expect, afterEach } from "vitest";
import { demoReply, makeDemoFetch, DEMO_KEY } from "../../src/graph/aiDemo";
import { validateText, hardIssues, formatIssues } from "../../src/graph/graphValidate";
import { readTextForm } from "../../src/graph/textForm";
import { runAiPrompt } from "../../src/graph/aiService";
import { apiKeyStore } from "../../src/graph/apiKeyStore";
import { runGraph } from "../../scripts/run-graph";
import type { SavedGraph } from "../../src/graph/persistence";

const EMPTY = '---\n{ "v": 2 }\n';
const FENCE_RE = /```solenoid\n([\s\S]*?)```/;

function fenceOf(reply: string): string {
  const m = FENCE_RE.exec(reply);
  expect(m, `expected a fenced rewrite, got: ${reply.slice(0, 120)}`).toBeTruthy();
  return m![1];
}

afterEach(() => apiKeyStore.set("ai", ""));

describe("demoReply — the staged build", () => {
  it("walks data → totals → chart, each stage validator-clean, then reports done", () => {
    let doc = EMPTY;
    const markers = ["DemoSales", "DemoByRegion", "DemoChart"];
    for (const marker of markers) {
      const next = fenceOf(demoReply("build the next step", doc));
      expect(formatIssues(hardIssues(validateText(next).issues))).toBe("");
      expect(next).toContain(marker);
      doc = next;
    }
    // The build is complete — a further edit prompt gets prose, not a fence.
    const done = demoReply("more", doc);
    expect(FENCE_RE.test(done)).toBe(false);
    expect(done).toContain("complete");
  });

  it("computes the right numbers when the finished build runs", async () => {
    let doc = EMPTY;
    for (let i = 0; i < 3; i++) doc = fenceOf(demoReply("go", doc));
    const g = readTextForm(doc) as unknown as Parameters<typeof runGraph>[0];
    const out = await runGraph(g);
    const totals = (out["Revenue by region"] as { frame: { columns: Array<{ name: string; values: unknown[] }> } }).frame;
    const byName = Object.fromEntries(totals.columns.map((c) => [c.name, c.values]));
    // North: 120·9.5 + 80·14 + 45·22 = 3250; South: 95·9.5 + 60·14 + 30·22 = 2402.5
    expect(byName.Region).toEqual(["North", "South"]);
    expect(byName.Revenue).toEqual([3250, 2402.5]);
  });

  it("keeps an existing document intact and builds to its right", () => {
    const own = 'Mine: NumberInputNode label="Mine" value=1\n---\n{ "v": 2, "positions": { "Mine": { "x": 700, "y": 50 } } }\n';
    const next = fenceOf(demoReply("add the demo", own));
    const g: SavedGraph = readTextForm(next);
    const names = g.nodes.map((n) => n.name ?? n.id);
    expect(names).toContain("Mine");
    expect(names).toContain("DemoSales");
    const mine = g.nodes.find((n) => (n.name ?? n.id) === "Mine")!;
    expect(mine.x).toBe(700);
    const sales = g.nodes.find((n) => (n.name ?? n.id) === "DemoSales")!;
    expect(sales.x).toBeGreaterThan(700);
  });

  it("answers a question with a document summary instead of an edit", () => {
    const doc = fenceOf(demoReply("go", EMPTY));
    const answer = demoReply("what is in this document?", doc);
    expect(FENCE_RE.test(answer)).toBe(false);
    expect(answer).toContain("3 nodes");
  });
});

describe("the demo transport through the real service", () => {
  it("runs the full pipeline: fence → validator → canonical edit", async () => {
    apiKeyStore.set("ai", DEMO_KEY);
    const out = await runAiPrompt("start the demo", EMPTY, { fetch: makeDemoFetch(0) });
    expect(out.kind).toBe("edit");
    if (out.kind !== "edit") return;
    expect(out.newText).toContain("DemoSales");
    expect(out.warnings).toEqual([]);
  });

  it("routes onto the demo transport from the key alone", async () => {
    apiKeyStore.set("ai", DEMO_KEY);
    const out = await runAiPrompt("how many nodes are here?", EMPTY);
    expect(out.kind).toBe("answer");
    if (out.kind !== "answer") return;
    expect(out.text).toContain("empty");
  });
});
