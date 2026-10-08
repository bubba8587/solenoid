// [[C107]] obsidianPlugin, [[D90]] cubeTypesAtDepth
import { it, expect, vi } from "vitest";

// The plugin edits column types without touching the note, so a Refresh of an unchanged note must still re-read them.
const files = new Map<string, string>();
vi.mock("../../src/graph/fileBridge", () => ({
  hasFs: () => true,
  readVaultFile: async (_vault: string, rel: string) => { const t = files.get(rel); if (t === undefined) throw new Error("missing"); return t; },
  writeTextFilePath: async () => {}, joinPath: async (...p: string[]) => p.join("/"), listMarkdownFiles: async () => [], readFileText: async () => "", pathExists: async () => false,
  listVaultMarkdownFiles: async () => [...files.keys()].filter((f) => f.endsWith(".md")),
}));
vi.mock("../../src/graph/demoVault", () => ({ getVaultRoot: () => "/vault", isDemoVaultPath: () => false }));

const { ImportObsidianNode } = await import("../../src/graph/nodes/obsidian");
const { PLUGIN_DATA_PATH } = await import("../../src/graph/pluginDataPath");

it("a Refresh re-reads the plugin's column picks for a note whose text hasn't changed", async () => {
  const note = "---\nbudget:\n  - item: Tile\n    cost: 12\n---\n";
  files.set("Home.md", note);
  files.set(PLUGIN_DATA_PATH, JSON.stringify({ columnTypes: {} }));
  const n = new ImportObsidianNode({ fileName: "Home.md" });
  await n.reloadFile();
  expect(n.columnPicks).toEqual({});
  files.set(PLUGIN_DATA_PATH, JSON.stringify({ columnTypes: { budget: { cost: "string" } } }));
  await n.reloadFile();
  expect(n.columnPicks).toEqual({ budget: { cost: "string" } });
});
