// [[C132]] workspaceTree, [[workspace-tree#Where the tree comes from]]
// On the desktop every kept document is a file under the Documents folder, and autosave writes through to it.
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

const disk = { files: new Map<string, string>(), dirs: new Set<string>(), fail: false, onCheck: null as null | ((path: string) => boolean) };
vi.mock("../../src/graph/fileBridge", async (orig) => ({
  ...(await orig<typeof import("../../src/graph/fileBridge")>()),
  isDesktop: () => true,
  isAndroidApp: () => false,
  documentsDir: async () => "/home/u/Documents",
  joinPath: async (...parts: string[]) => parts.join("/"),
  ensureDir: async (p: string) => { disk.dirs.add(p); },
  pathExists: async (p: string) => { if (disk.onCheck?.(p)) disk.onCheck = null; return disk.files.has(p); },
  writeTextFilePath: async (p: string, text: string) => {
    if (disk.fail) throw new Error("read-only");
    disk.files.set(p, text);
  },
}));
const live: { g: unknown } = { g: { version: 1, nodes: [], connections: [] } };
vi.mock("../../src/graph/persistence", async (orig) => ({
  ...(await orig<typeof import("../../src/graph/persistence")>()),
  serializeGraph: () => live.g,
  loadGraph: async () => true,
}));

const { documentStore } = await import("../../src/graph/documentStore");
const { settingsStore } = await import("../../src/graph/settingsStore");
const { syncFiles, fileStem } = await import("../../src/graph/desktopDocs");

const fileOf = (name: string) => documentStore.fileWork().find((d) => d.name === name)?.filePath;

beforeEach(() => { disk.files.clear(); disk.dirs.clear(); disk.fail = false; disk.onCheck = null; });

describe("every kept desktop document is a file", () => {
  it("a document gets <Documents>/Solenoid/<folder>/<name>.json, numbered past a taken name, and the setting keeps the root", async () => {
    settingsStore.set("docsFolder", "");
    documentStore.saveAs("Budget");
    disk.files.set("/home/u/Documents/Solenoid/Untitled.json", "{}");
    documentStore.saveAs("Untitled");
    await syncFiles();
    expect(fileOf("Budget")).toBe("/home/u/Documents/Solenoid/Budget.json");
    expect(fileOf("Untitled")).toBe("/home/u/Documents/Solenoid/Untitled 2.json");
    expect(settingsStore.get("docsFolder")).toBe("/home/u/Documents/Solenoid");
    expect(JSON.parse(disk.files.get("/home/u/Documents/Solenoid/Budget.json")!).savedAt).toBeTypeOf("number");
  });

  it("a document in a folder lands in that folder, created", async () => {
    settingsStore.set("docsFolder", "/data/docs");
    documentStore.saveAs("Q3");
    const id = documentStore.fileWork().find((d) => d.name === "Q3")!.id;
    documentStore.moveToFolder(id, "Finance/2026");
    await syncFiles();
    expect(fileOf("Q3")).toBe("/data/docs/Finance/2026/Q3.json");
    expect(disk.dirs.has("/data/docs/Finance/2026")).toBe(true);
  });

  it("an edit writes through once; a document already caught up isn't rewritten", async () => {
    settingsStore.set("docsFolder", "/data/docs");
    documentStore.saveAs("Live");
    await syncFiles();
    const path = fileOf("Live")!;
    disk.files.delete(path);
    await syncFiles();
    expect(disk.files.has(path)).toBe(false);
    const id = documentStore.fileWork().find((d) => d.name === "Live")!.id;
    documentStore.rename(id, "Live");
    documentStore.markFileSaved(id, 0);
    await syncFiles();
    expect(disk.files.has(path)).toBe(true);
  });

  it("an edit made while the pass picks a new document's file name stays unsaved, and goes next pass", async () => {
    settingsStore.set("docsFolder", "/data/docs");
    live.g = { version: 1, nodes: [{ id: "a", type: "ConstantNode", x: 0, y: 0, init: {} }], connections: [] };
    documentStore.saveAs("Fresh");
    const id = documentStore.currentId()!;
    let clock = Date.now() + 10_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => ++clock);
    try {
      // The edit lands while the pass is still finding the new document a free name.
      disk.onCheck = (path) => {
        if (!path.endsWith("/Fresh.json")) return false;
        live.g = { version: 1, nodes: [{ id: "b", type: "ConstantNode", x: 0, y: 0, init: {} }], connections: [] };
        documentStore.captureCurrent();
        return true;
      };
      await syncFiles();
      const after = documentStore.fileWork().find((d) => d.id === id)!;
      expect(after.updatedAt).toBeGreaterThan(after.fileSavedAt ?? 0);
      await syncFiles();
      expect(disk.files.get(after.filePath!)).toContain('"b"');
    } finally {
      now.mockRestore();
      live.g = { version: 1, nodes: [], connections: [] };
    }
  });

  it("a failed write leaves the document unbound and unsaved", async () => {
    settingsStore.set("docsFolder", "/data/docs");
    documentStore.saveAs("Stuck");
    disk.fail = true;
    await syncFiles();
    expect(fileOf("Stuck")).toBeUndefined();
    disk.fail = false;
    await syncFiles();
    expect(fileOf("Stuck")).toBe("/data/docs/Stuck.json");
  });

  it("an example stays out of the folder until it is kept", async () => {
    settingsStore.set("docsFolder", "/data/docs");
    const before = disk.files.size;
    expect(documentStore.fileWork().every((d) => d.name !== "Getting started")).toBe(true);
    await syncFiles();
    expect([...disk.files.keys()].filter((p) => p.includes("Getting started")).length).toBe(0);
    expect(disk.files.size).toBeGreaterThanOrEqual(before);
  });
});

describe("fileStem", () => {
  it("keeps a name a file can carry on every system", () => {
    expect(fileStem("Q3: draft/final?")).toBe("Q3 draft final");
    expect(fileStem("plan.json")).toBe("plan");
    expect(fileStem("  ")).toBe("Untitled");
    expect(fileStem("..")).toBe("Untitled");
    expect(fileStem(".plan")).toBe("plan");
    expect(fileStem("notes.")).toBe("notes");
    expect(fileStem("CON")).toBe("CON doc");
    expect(fileStem("nul.txt")).toBe("nul.txt doc");
    expect(fileStem("Console")).toBe("Console");
  });
});
