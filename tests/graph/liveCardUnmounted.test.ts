// [[C23]] calcModes
import { describe, it, expect, vi, afterEach } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import type { Schemes } from "../../src/graph/schemes";
import type { View } from "../../src/graph/view";
import { CompositeNode, CompositeOutputNode } from "../../src/graph/nodes/composite";
import { WebSourceNode, FxNode } from "../../src/graph/nodes/connection";
import { ValueInputNode } from "../../src/graph/nodes/control";
import { connectionStore, refreshConnection, refreshAllConnections, scheduleConnectionRecalc, fetchInBackground } from "../../src/graph/connectionStore";
import { registerOwnedGraph } from "../../src/graph/activeGraph";

const realFetch = globalThis.fetch;
afterEach(() => { vi.useRealTimers(); globalThis.fetch = realFetch; });

const run = (n: WebSourceNode) => (n as unknown as { data(i: object): unknown }).data({});

async function manualCompositeWith(inner: Schemes["Node"], srcOut = Object.keys(inner.outputs)[0]) {
  const c = new CompositeNode({ runMode: "manual" });
  const out = new CompositeOutputNode({ label: "X" });
  await c.internalEditor.addNode(inner);
  await c.internalEditor.addNode(out as unknown as Schemes["Node"]);
  await c.internalEditor.addConnection(new ClassicPreset.Connection(inner, srcOut as never, out, "value" as never) as Schemes["Connection"]);
  c.addOutputPort({ label: "X", tier: "basic", internalNodeId: out.id });
  return c;
}

describe("a heavy composite holding a live card", () => {
  it("turns stale when the card is refreshed and when its fetch lands", async () => {
    const card = new WebSourceNode({ url: "" });
    const c = await manualCompositeWith(card as unknown as Schemes["Node"]);
    c.requestSolve();
    await c.data({});
    expect(c.stale).toBe(false);

    await refreshConnection(card.id);
    await c.data({});
    expect(c.stale).toBe(true);

    c.requestSolve();
    await c.data({});
    expect(c.stale).toBe(false);
    scheduleConnectionRecalc(card.id);
    await c.data({});
    expect(c.stale).toBe(true);

    c.requestSolve();
    await c.data({});
    await refreshAllConnections();
    await c.data({});
    expect(c.stale).toBe(true);
  });

  it("the first Solve waits for the fetch it starts", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200, statusText: "OK",
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ base: "USD", date: "2026-09-01", rates: { EUR: 0.9 } }),
    })) as unknown as typeof fetch;
    const fx = new FxNode();
    fx.stringLiterals.from = "USD";
    fx.stringLiterals.to = "EUR";
    const c = await manualCompositeWith(fx as unknown as Schemes["Node"], "rate");
    c.requestSolve();
    const out = await c.data({});
    expect(Object.values(out)[0]).toBe(0.9);
    expect(c.stale).toBe(false);
  });

  it("a Solve that runs out of rounds while fetches still land stays stale", async () => {
    class Restless extends ClassicPreset.Node {
      runs = 0;
      constructor() { super("Restless"); this.addOutput("value", new ClassicPreset.Output(new ClassicPreset.Socket("number"))); }
      data() { this.runs++; fetchInBackground(this.id, Promise.resolve()); return { value: this.runs }; }
    }
    const card = new Restless();
    const c = await manualCompositeWith(card as unknown as Schemes["Node"], "value");
    c.requestSolve();
    await c.data({});
    expect(card.runs).toBeGreaterThan(1);
    expect(c.stale).toBe(true);
    await c.data({});
    expect(c.stale).toBe(true);
  });

  it("holds when a refresh-all has no live card inside it", async () => {
    const c = await manualCompositeWith(new ValueInputNode() as unknown as Schemes["Node"]);
    c.requestSolve();
    await c.data({});
    await refreshAllConnections();
    await c.data({});
    expect(c.stale).toBe(false);
  });
});

describe("a reply for a URL the card has moved past lands nowhere", () => {
  it("Web Source keeps the newer URL's data when the older reply comes back last", async () => {
    const resolvers = new Map<string, (body: string) => void>();
    globalThis.fetch = vi.fn((url: string) => new Promise((res) => {
      resolvers.set(String(url), (body) => res({
        ok: true, status: 200, statusText: "OK",
        headers: { get: () => "text/csv" }, text: async () => body,
      }));
    })) as unknown as typeof fetch;
    const card = new WebSourceNode({ url: "https://a.example/a.csv" });
    run(card);
    card.url = "https://b.example/b.csv";
    run(card);
    await vi.waitFor(() => expect(resolvers.size).toBe(2));
    resolvers.get("https://b.example/b.csv")!("v\n2");
    await vi.waitFor(() => expect(connectionStore.getState(card.id).status).toBe("ok"));
    resolvers.get("https://a.example/a.csv")!("v\n1");
    await new Promise((r) => setTimeout(r, 0));
    const frame = run(card) as { frame: { columns: { values: unknown[] }[] } };
    expect(frame.frame.columns[0].values).toEqual([2]);
  });

  it("Web Source moved to a new URL and back keeps the first URL's data when the new reply lands", async () => {
    const resolvers = new Map<string, (body: string) => void>();
    globalThis.fetch = vi.fn((url: string) => new Promise((res) => {
      resolvers.set(String(url), (body) => res({
        ok: true, status: 200, statusText: "OK",
        headers: { get: () => "text/csv" }, text: async () => body,
      }));
    })) as unknown as typeof fetch;
    const card = new WebSourceNode({ url: "https://a.example/a.csv" });
    run(card);
    await vi.waitFor(() => expect(resolvers.size).toBe(1));
    resolvers.get("https://a.example/a.csv")!("v\n1");
    await vi.waitFor(() => expect(connectionStore.getState(card.id).status).toBe("ok"));
    card.url = "https://b.example/b.csv";
    run(card);
    card.url = "https://a.example/a.csv";
    run(card);
    await vi.waitFor(() => expect(resolvers.size).toBe(2));
    resolvers.get("https://b.example/b.csv")!("v\n2");
    await new Promise((r) => setTimeout(r, 0));
    const frame = run(card) as { frame: { columns: { values: unknown[] }[] } };
    expect(frame.frame.columns[0].values).toEqual([1]);
  });
});

describe("auto-refresh runs from the card's data(), not its component", () => {
  it("a card inside a composite refreshes on its cadence, and a deleted one stops", async () => {
    vi.useFakeTimers();
    // An owned graph, not the main editor: the refresh's processGraph then has no pass to run.
    const editor = new NodeEditor<Schemes>();
    const unregister = registerOwnedGraph({ editor, view: {} as View });

    const card = new WebSourceNode({ url: "", refreshMinutes: 1 });
    const c = await manualCompositeWith(card as unknown as Schemes["Node"]);
    await editor.addNode(c as unknown as Schemes["Node"]);
    run(card);
    expect(connectionStore.autoRefreshMinutes(card.id)).toBe(1);

    const t0 = connectionStore.token(card.id);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connectionStore.token(card.id)).toBe(t0 + 1);

    await editor.removeNode(c.id);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connectionStore.token(card.id)).toBe(t0 + 1);
    expect(connectionStore.autoRefreshMinutes(card.id)).toBe(0);
    unregister();
  });

  it("turning the cadence to 0 clears the timer", () => {
    const card = new WebSourceNode({ url: "", refreshMinutes: 5 });
    run(card);
    expect(connectionStore.autoRefreshMinutes(card.id)).toBe(5);
    card.refreshMinutes = 0;
    run(card);
    expect(connectionStore.autoRefreshMinutes(card.id)).toBe(0);
  });
});
