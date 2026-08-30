import { describe, it, expect } from "vitest";

// Per-doc autosave keys (2026-07-05): each document persists under its own
// two-slot pair plus a light index — an edit writes ONLY the changed doc, and
// deleting a doc removes its keys. Exercised through the real documentStore
// against an in-memory localStorage stub (vitest env is node). The store runs
// editor-less here: serializeGraph() returns null, so doc graphs stay the
// EMPTY_GRAPH they were created with — persistence shape is what's under test.

const _mem = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => _mem.get(k) ?? null,
  setItem: (k: string, v: string) => { _mem.set(k, v); },
  removeItem: (k: string) => { _mem.delete(k); },
  clear: () => { _mem.clear(); },
  key: (i: number) => [..._mem.keys()][i] ?? null,
  get length() { return _mem.size; },
};
(globalThis as Record<string, unknown>).localStorage = localStorageStub;

const { documentStore } = await import("../../src/graph/documentStore");
const { saveTimeStore } = await import("../../src/graph/saveTimeStore");

const keysMatching = (re: RegExp) => [..._mem.keys()].filter((k) => re.test(k));
const docKeysFor = (id: string) => keysMatching(new RegExp(`^solenoid\\.docs\\.doc\\.${id}\\.`));

describe("per-doc autosave keys", () => {
  it("writes one index pair + one slot per document; an untouched doc is not rewritten", () => {
    documentStore.saveAs("Alpha");
    documentStore.saveAs("Beta");
    const metas = documentStore.list();
    const alpha = metas.find((m) => m.name === "Alpha")!;
    const beta = metas.find((m) => m.name === "Beta")!;
    expect(keysMatching(/^solenoid\.docs\.index\./).length).toBeGreaterThan(0);
    expect(docKeysFor(alpha.id).length).toBeGreaterThan(0);
    expect(docKeysFor(beta.id).length).toBeGreaterThan(0);

    // Renaming Beta persists Beta + the index — Alpha's stored bytes must not move.
    const alphaBytes = docKeysFor(alpha.id).map((k) => [k, _mem.get(k)] as const);
    documentStore.rename(beta.id, "Beta Renamed");
    for (const [k, v] of alphaBytes) expect(_mem.get(k)).toBe(v);
    const betaSlot = docKeysFor(beta.id).map((k) => _mem.get(k)).join("");
    expect(betaSlot).toContain("Beta Renamed");
  });

  it("deleting a document removes its keys (frees its quota)", async () => {
    documentStore.saveAs("Gamma");
    documentStore.saveAs("Delta"); // current is now Delta, so removing Gamma skips the load path
    const gamma = documentStore.list().find((m) => m.name === "Gamma")!;
    expect(docKeysFor(gamma.id).length).toBeGreaterThan(0);
    await documentStore.remove(gamma.id);
    expect(docKeysFor(gamma.id)).toEqual([]);
  });

  it("restore() reads the index + per-doc slots back into the library", async () => {
    documentStore.saveAs("Epsilon");
    const before = documentStore.list().map((m) => m.name);
    await documentStore.restore();
    const after = documentStore.list().map((m) => m.name);
    for (const name of before) expect(after).toContain(name);
  });

  it("restore() deletes the abandoned whole-library keys", async () => {
    _mem.set("solenoid.docs.lib.a", '{"seq":1,"lib":{}}');
    _mem.set("solenoid.docs.lib.b", '{"seq":2,"lib":{}}');
    await documentStore.restore();
    expect(_mem.has("solenoid.docs.lib.a")).toBe(false);
    expect(_mem.has("solenoid.docs.lib.b")).toBe(false);
  });

  it("a corrupt doc slot is skipped on restore, not fatal", async () => {
    documentStore.saveAs("Zeta");
    const zeta = documentStore.list().find((m) => m.name === "Zeta")!;
    for (const k of docKeysFor(zeta.id)) _mem.set(k, "{not json");
    await documentStore.restore();
    expect(documentStore.list().some((m) => m.name === "Zeta")).toBe(false);
  });
});

describe("the save clock — saveTimeStore reads the CURRENT doc through the provider", () => {
  it("markCurrentFileSaved stamps only the current doc, and the stamp is persisted", () => {
    documentStore.saveAs("Clock A");
    const a = documentStore.list().find((m) => m.name === "Clock A")!;
    expect(saveTimeStore.lastAutosaveAt()).not.toBeNull(); // stamped when the doc landed in storage
    expect(saveTimeStore.lastFileSaveAt()).toBeNull();     // never written to a file

    documentStore.markCurrentFileSaved();
    const stamp = saveTimeStore.lastFileSaveAt();
    expect(stamp).not.toBeNull();

    // The stamp rides the persisted doc slot; validateDoc carries it back on restore.
    const stored = docKeysFor(a.id).map((k) => JSON.parse(_mem.get(k)!) as { doc?: { fileSavedAt?: number } });
    expect(stored.some((s) => s.doc?.fileSavedAt === stamp)).toBe(true);

    // A different current doc reads ITS clock: the fresh fork was never file-saved.
    documentStore.saveAs("Clock B");
    expect(saveTimeStore.lastFileSaveAt()).toBeNull();
  });

  it("importAsDocument seeds BOTH clocks from the file's own savedAt stamp", async () => {
    await documentStore.importAsDocument(
      { v: 2, nodes: [], connections: [], savedAt: 1786871100000 },
      "Traveled",
      "/elsewhere/Traveled.json",
    );
    const doc = documentStore.list().find((m) => m.name === "Traveled")!;
    const stored = docKeysFor(doc.id).map((k) => JSON.parse(_mem.get(k)!) as { doc?: { fileSavedAt?: number; updatedAt?: number } });
    expect(stored.some((s) => s.doc?.fileSavedAt === 1786871100000)).toBe(true);
    // The autosave clock (updatedAt) reads the file's stamp too — autosave is the
    // primary save, so a traveled doc shows when its content was last saved.
    expect(stored.some((s) => s.doc?.updatedAt === 1786871100000)).toBe(true);
  });

  it("importAsDocument leaves the clocks fresh/blank for a file with no stamp (old saves)", async () => {
    const t0 = Date.now();
    await documentStore.importAsDocument({ v: 2, nodes: [], connections: [] }, "Unstamped");
    const doc = documentStore.list().find((m) => m.name === "Unstamped")!;
    const stored = docKeysFor(doc.id).map((k) => JSON.parse(_mem.get(k)!) as { doc?: { fileSavedAt?: number; updatedAt?: number } });
    expect(stored.every((s) => s.doc?.fileSavedAt === undefined)).toBe(true);
    expect(stored.some((s) => (s.doc?.updatedAt ?? 0) >= t0)).toBe(true); // adoption time, not zero
  });
});

// ─── autosaveSlotOrder — slot freshness is a PREFIX read, so `seq` must come first ────
// readSlotSeq decides which slot is newer with /^\{"seq":(\d+)/ — a prefix
// regex, deliberately not a parse (the doc blob is large). A payload whose
// stringify puts any other key first reads as seq null: chooseWriteSlot(null,…)
// collapses the rotation to always-overwrite-A and chooseReadSlot resurrects
// the OLDER write — silent loss of the newest edit, with perfectly valid JSON
// in both slots. This pins the coupling the writers currently honor by literal
// key order alone.
describe("autosaveSlotOrder — every written slot payload starts {\"seq\":N and seq strictly increases", () => {
  const slotKeys = () => [..._mem.keys()].filter((k) => /^solenoid\.docs\.(index|doc\.[^.]+)\.(a|b)$/.test(k));

  it("every slot payload the STORE wrote is prefix-readable", () => {
    // The corrupt-slot restore test above plants "{not json" by hand — that
    // fixture is exactly what this rule protects against and is not a store
    // write; drop it before sweeping.
    for (const [k, v] of [..._mem]) if (v === "{not json") _mem.delete(k);
    documentStore.saveAs("SeqCheck");
    expect(slotKeys().length).toBeGreaterThan(0);
    for (const k of slotKeys()) {
      expect(_mem.get(k)!, `${k} does not start with {"seq": — readSlotSeq will read it as EMPTY`).toMatch(/^\{"seq":\d+/);
    }
  });

  it("successive writes to one pair carry strictly increasing seq", () => {
    documentStore.saveAs("SeqCheck2");
    const metas = documentStore.list();
    const d = metas.find((m) => m.name === "SeqCheck2")!;
    const seqOf = (k: string) => Number(/^\{"seq":(\d+)/.exec(_mem.get(k) ?? "")?.[1] ?? NaN);
    const pair = () => [`solenoid.docs.doc.${d.id}.a`, `solenoid.docs.doc.${d.id}.b`].filter((k) => _mem.has(k));
    const before = Math.max(...pair().map(seqOf));
    documentStore.rename(d.id, "SeqCheck2 Renamed");
    const after = Math.max(...pair().map(seqOf));
    expect(after, "a rewrite must carry a strictly larger seq — a tie makes newest-slot selection ambiguous").toBeGreaterThan(before);
  });
});
