import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import { WebSourceNode } from "./nodes/connection";
import { GetColumnNode } from "./nodes/frame";
import { AlertNode } from "./nodes/display";
import { connectionStore, refreshConnection } from "./connectionStore";
import { alertStore } from "./alertStore";
import { isGraphRebuilding } from "./process";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards } from "./errorValue";
import type { Schemes } from "./schemes";

// Tier 1/2 live-data (bundle 07, #3): refreshConnection(id) — the function a
// manual Refresh button AND an interval timer both call — must drive a REAL
// recompute that an AlertNode downstream still fires off, exactly as it would
// off a manual edit. The one thing that could silently break this is
// refreshConnection accidentally running inside a "graph rebuild" scope (the
// ONLY gate AlertNode.detectAndFire checks — see nodes/display.ts) the way
// loadGraph does; it must not.

function mockCsvResponse(body: string) {
  return {
    ok: true, status: 200, statusText: "OK",
    headers: { get: () => "text/csv" },
    text: async () => body,
  } as unknown as Response;
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });
beforeEach(() => alertStore.clear());

describe("connectionStore refresh drives a real recompute that AlertNode still fires off", () => {
  it("refreshConnection never enters a graph-rebuild scope (the only thing that would silently suppress a fire)", async () => {
    expect(isGraphRebuilding()).toBe(false);
    const p = refreshConnection("nonexistent-node-id"); // no editor singleton set → processGraph no-ops safely
    expect(isGraphRebuilding()).toBe(false);
    await p;
    expect(isGraphRebuilding()).toBe(false);
  });

  it("a refresh-triggered fetch changes the value flowing to a downstream Alert, and the rising edge fires", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => mockCsvResponse(call++ === 0 ? "v\n50" : "v\n150"));

    const editor = new NodeEditor<Schemes>();
    installInputCoercion(editor);
    editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);

    const source = new WebSourceNode({ url: "https://example.com/data.csv" });
    const col = new GetColumnNode({ readAs: "number" });
    col.stringLiterals.name = "v";
    const alert = new AlertNode({ condition: "range" }); // default 0–100

    await editor.addNode(source as unknown as Schemes["Node"]);
    await editor.addNode(col as unknown as Schemes["Node"]);
    await editor.addNode(alert as unknown as Schemes["Node"]);
    await editor.addConnection(
      new ClassicPreset.Connection(source, "frame", col, "frame") as Schemes["Connection"],
    );
    await editor.addConnection(
      new ClassicPreset.Connection(col, "values", alert, "value") as Schemes["Connection"],
    );

    // Drive the source's first fetch directly (deterministic — bypasses the
    // fire-and-forget background-fetch scheduling WebSourceNode.data() uses,
    // which exists for the live app's async-critical-path constraint, not for
    // a headless test) so `engine.fetch` sees a populated cache immediately.
    const key1 = connectionStore.key(source.id, source.url.trim());
    await (source as unknown as { fetchFrame(ref: string, key: string): Promise<unknown> }).fetchFrame(source.url.trim(), key1);

    await engine.fetch(alert.id); // 50: calm, within [0,100]
    expect(alertStore.list().length).toBe(0);

    // A manual click and an interval timer both call exactly this function.
    await refreshConnection(source.id);
    expect(isGraphRebuilding()).toBe(false);

    const key2 = connectionStore.key(source.id, source.url.trim());
    expect(key2).not.toBe(key1); // the refresh actually changed the cache key
    await (source as unknown as { fetchFrame(ref: string, key: string): Promise<unknown> }).fetchFrame(source.url.trim(), key2);

    engine.reset(); // invalidate the engine's per-node cache so the new value is read
    await engine.fetch(alert.id); // 150: above High → rising edge → fires
    expect(alertStore.list().length).toBe(1);
    expect(alertStore.list()[0].message).toContain("above");
  });
});
