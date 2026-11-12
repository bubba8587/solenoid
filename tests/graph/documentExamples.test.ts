// [[save-format#A save loses nothing quietly]], [[per-doc-autosave-persistence#Examples]]
// A seed opened from the menus is an example: out of the file tree, dropped when left as it opened, and asked about
// (Keep, Discard, Cancel) when left changed. Editor-less: the tests hand the capture a graph to stand for an edit.
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

const liveGraph: { g: unknown } = { g: null };
vi.mock("../../src/graph/persistence", async (orig) => {
  const real = await orig<typeof import("../../src/graph/persistence")>();
  return { ...real, serializeGraph: () => liveGraph.g, loadGraph: async () => true };
});

const { documentStore } = await import("../../src/graph/documentStore");
const { confirmStore, answerConfirm } = await import("../../src/graph/confirmStore");
const { graphFingerprint } = await import("../../src/graph/documentStoreCore");
const { SEEDS } = await import("../../src/graph/seeds");
const { saveNow } = await import("../../src/graph/fileSession");
const { onTreeRename } = await import("../../src/graph/treeRename");

const asLoaded = (id: string) => JSON.parse(JSON.stringify(SEEDS[id].graph));
const names = () => documentStore.list().map((d) => d.name).sort();
/** Opens an example as the load would leave it on screen. */
async function openExample(id: string) {
  liveGraph.g = asLoaded(id);
  await documentStore.newFromTemplate(id);
}
/** An edit on screen: a node moved. */
function edit() {
  const g = JSON.parse(JSON.stringify(liveGraph.g)) as { nodes: { x: number }[] };
  g.nodes[0].x += 40;
  liveGraph.g = g;
}
/** Starts a verb that leaves the example, answers the dialog if one asks, and waits for the verb. */
async function leave(answer?: "confirm" | "alt" | "cancel"): Promise<boolean> {
  const verb = documentStore.newFromTemplate("cubes");
  await Promise.resolve();
  const asked = !!confirmStore.get();
  if (asked) answerConfirm(answer ?? "cancel");
  liveGraph.g = asked && answer === "cancel" ? liveGraph.g : asLoaded("cubes");
  await verb;
  return asked;
}

beforeEach(async () => {
  // Every test starts from one kept document, so the tree's contents read plainly; a changed example a test left
  // open is kept first, or the reset would wait on its dialog.
  if (documentStore.currentIsExample()) documentStore.keepCurrent();
  await documentStore.newFromTemplate("allocator", undefined, { asDocument: true });
  for (const d of documentStore.list()) if (d.name !== "Budget Allocator") await documentStore.remove(d.id);
});

describe("an example", () => {
  it("opens outside the file tree", async () => {
    await openExample("equation-solver");
    expect(documentStore.currentIsExample()).toBe(true);
    expect(names()).not.toContain(SEEDS["equation-solver"].label);
  });

  it("left as it opened goes without asking", async () => {
    await openExample("equation-solver");
    expect(await leave()).toBe(false);
    expect(names()).not.toContain(SEEDS["equation-solver"].label);
    expect(documentStore.currentName()).toBe(SEEDS.cubes.label);
  });

  it("left changed asks; Keep puts it in the file tree", async () => {
    await openExample("equation-solver");
    edit();
    expect(await leave("confirm")).toBe(true);
    expect(names()).toContain(SEEDS["equation-solver"].label);
  });

  it("Discard drops it", async () => {
    await openExample("equation-solver");
    edit();
    expect(await leave("alt")).toBe(true);
    expect(names()).not.toContain(SEEDS["equation-solver"].label);
    expect(documentStore.currentName()).toBe(SEEDS.cubes.label);
  });

  it("Cancel stays on it, changed", async () => {
    await openExample("equation-solver");
    edit();
    expect(await leave("cancel")).toBe(true);
    expect(documentStore.currentName()).toBe(SEEDS["equation-solver"].label);
    expect(documentStore.currentExampleEdited()).toBe(true);
  });

  it("a file save keeps it", async () => {
    await openExample("equation-solver");
    documentStore.bindToPath(documentStore.currentId()!, "/tmp/eq.solenoid");
    expect(documentStore.currentIsExample()).toBe(false);
    expect(names()).toContain(SEEDS["equation-solver"].label);
  });

  it("from the file tree's New from template, a seed is a document at once", async () => {
    liveGraph.g = asLoaded("table-verbs");
    await documentStore.newFromTemplate("table-verbs", undefined, { asDocument: true });
    expect(documentStore.currentIsExample()).toBe(false);
    expect(names()).toContain(SEEDS["table-verbs"].label);
  });
});

describe("Save is autosave done now ([[save-format#Where documents are stored]])", () => {
  it("on an example asks, and a yes keeps it in the file tree, named in place", async () => {
    await openExample("equation-solver");
    const renamed: string[] = [];
    const off = onTreeRename((id) => renamed.push(id));
    const run = saveNow();
    await Promise.resolve();
    expect(confirmStore.get()?.confirmLabel).toBe("Save");
    answerConfirm("confirm");
    await run;
    off();
    expect(documentStore.currentIsExample()).toBe(false);
    expect(names()).toContain(SEEDS["equation-solver"].label);
    expect(renamed).toEqual([documentStore.currentId()]);
  });

  it("on an example, Cancel leaves it an example", async () => {
    await openExample("equation-solver");
    const run = saveNow();
    await Promise.resolve();
    answerConfirm("cancel");
    await run;
    expect(documentStore.currentIsExample()).toBe(true);
  });

  it("on a document asks nothing and captures the edit", async () => {
    liveGraph.g = asLoaded("allocator");
    edit();
    await saveNow();
    expect(confirmStore.get()).toBeNull();
    expect(documentStore.searchable().find((d) => d.id === documentStore.currentId())?.graph).toEqual(liveGraph.g);
  });
});

describe("graphFingerprint", () => {
  const g = { v: 2, nodes: [{ id: "a", type: "NoteNode", x: 0, y: 0, init: { label: "n", width: 200, height: 100 } }], connections: [] };
  const variant = (node: Record<string, unknown>) => ({ ...g, nodes: [{ ...g.nodes[0], ...node }] });
  it("ignores a card's auto-fitted width and height and the save time, and sees everything else", () => {
    const base = graphFingerprint(g as never);
    expect(graphFingerprint(variant({ init: { label: "n", width: 260, height: 140 } }) as never)).toBe(base);
    expect(graphFingerprint({ ...g, savedAt: 5 } as never)).toBe(base);
    expect(graphFingerprint(variant({ x: 10 }) as never)).not.toBe(base);
    expect(graphFingerprint(variant({ init: { label: "m", width: 200, height: 100 } }) as never)).not.toBe(base);
    expect(graphFingerprint(variant({ size: { w: 300, h: 200 } }) as never)).not.toBe(base);
  });
});
