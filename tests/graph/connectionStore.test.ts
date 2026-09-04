import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import { WebSourceNode } from "../../src/graph/nodes/connection";
import { GetColumnNode } from "../../src/graph/nodes/frame";
import { AlertNode } from "../../src/graph/nodes/display";
import { connectionStore, refreshConnection, networkAllowed, requestNetwork, allowNetwork } from "../../src/graph/connectionStore";
import { docMetaStore } from "../../src/graph/docMetaStore";
import { settingsStore } from "../../src/graph/settingsStore";
import { alertStore } from "../../src/graph/alertStore";
import { isGraphRebuilding } from "../../src/graph/process";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import type { Schemes } from "../../src/graph/schemes";

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

describe("C2 — per-document network permission gate", () => {
  afterEach(() => {
    docMetaStore.setDocMeta(null);
    settingsStore.set("alwaysAllowNetwork", false);
  });

  it("an OWN document is never gated", () => {
    docMetaStore.setDocMeta({}); // not foreign
    expect(networkAllowed()).toBe(true);
    expect(requestNetwork("n1")).toBe(true);
  });

  it("a FOREIGN, undecided document is gated (no fetch, node marked gated)", () => {
    docMetaStore.setDocMeta({ foreign: true });
    expect(networkAllowed()).toBe(false);
    expect(requestNetwork("n2")).toBe(false);
    expect(connectionStore.getState("n2").status).toBe("gated");
  });

  it("allowNetwork() grants the foreign document and opens the gate", () => {
    docMetaStore.setDocMeta({ foreign: true });
    expect(networkAllowed()).toBe(false);
    allowNetwork();
    expect(docMetaStore.networkAllowed()).toBe(true);
    expect(networkAllowed()).toBe(true);
    expect(requestNetwork("n3")).toBe(true);
  });

  it("the always-allow setting bypasses the gate for a foreign document", () => {
    docMetaStore.setDocMeta({ foreign: true });
    settingsStore.set("alwaysAllowNetwork", true);
    expect(networkAllowed()).toBe(true);
    expect(requestNetwork("n4")).toBe(true);
  });

  it("a prior grant persists in the meta and is honored on reload", () => {
    docMetaStore.setDocMeta({ foreign: true, networkAllowed: true });
    expect(networkAllowed()).toBe(true);
  });
});
