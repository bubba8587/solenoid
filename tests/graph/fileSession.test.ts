// [[B12]] losslessSaves
import { describe, it, expect, vi, beforeEach } from "vitest";

const _mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => _mem.get(k) ?? null,
  setItem: (k: string, v: string) => { _mem.set(k, v); },
  removeItem: (k: string) => { _mem.delete(k); },
  clear: () => { _mem.clear(); },
  key: (i: number) => [..._mem.keys()][i] ?? null,
  get length() { return _mem.size; },
};

const bridge = {
  pick: null as null | ((p: string | null) => void),
  bundle: null as null | (() => void),
  writes: [] as Array<{ path: string; text: string }>,
};
vi.mock("../../src/graph/fileBridge", async (orig) => ({
  ...(await orig<typeof import("../../src/graph/fileBridge")>()),
  isDesktop: () => true,
  pickSaveGraphPath: () => new Promise<string | null>((r) => { bridge.pick = r; }),
  writeTextFilePath: async (path: string, text: string) => { bridge.writes.push({ path, text }); },
}));
vi.mock("../../src/graph/imageAssets", async (orig) => ({
  ...(await orig<typeof import("../../src/graph/imageAssets")>()),
  bundleLocalImages: () => new Promise<{ failed: number }>((r) => { bridge.bundle = () => r({ failed: 0 }); }),
}));
vi.mock("../../src/graph/persistence", async (orig) => ({
  ...(await orig<typeof import("../../src/graph/persistence")>()),
  serializeGraph: () => ({ version: 1, nodes: [], connections: [] }),
}));

const { documentStore } = await import("../../src/graph/documentStore");
const { saveToDisk } = await import("../../src/graph/fileSession");

const tick = () => new Promise((r) => setTimeout(r, 0));
const docNamed = (name: string) => documentStore.list().find((m) => m.name === name)!;

beforeEach(() => { bridge.writes = []; bridge.pick = null; bridge.bundle = null; });

describe("saveToDisk binds and stamps the document it started on", () => {
  it("a switch while the Save dialog is open writes nothing and binds nothing", async () => {
    documentStore.saveAs("First");
    const run = saveToDisk();
    await tick();
    documentStore.saveAs("Second");
    bridge.pick!("/graphs/First.json");
    await run;
    expect(bridge.writes).toEqual([]);
    expect(documentStore.currentFilePath()).toBeNull();
  });

  it("a switch while images bundle writes nothing and binds nothing", async () => {
    documentStore.saveAs("Bound");
    const bound = docNamed("Bound");
    const run = saveToDisk();
    await tick();
    bridge.pick!("/graphs/Bound.json");
    await tick();
    documentStore.saveAs("Other");
    bridge.bundle!();
    await run;
    expect(bridge.writes).toEqual([]);
    await documentStore.open(bound.id);
    expect(documentStore.currentFilePath()).toBeNull();
  });

  it("an uninterrupted save binds and stamps the document it began on", async () => {
    documentStore.saveAs("Plain");
    const run = saveToDisk();
    await tick();
    bridge.pick!("/graphs/Plain.json");
    await tick();
    bridge.bundle!();
    await run;
    expect(bridge.writes.map((w) => w.path)).toEqual(["/graphs/Plain.json"]);
    expect(documentStore.currentFilePath()).toBe("/graphs/Plain.json");
  });
});
