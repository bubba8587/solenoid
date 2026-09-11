import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, cpSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGraph } from "./run-graph";
import { setFsProvider } from "../src/graph/fileBridge";
import { isCubeValue, type CubeValue } from "../src/graph/frame";

// Bundle 24 J — the headless seam: `run-graph --vault <path>` installs a Node file
// provider behind fileBridge so the Obsidian nodes read a vault with no window, and
// `--run <name>` arms and runs ONE named sink (the Run button's headless equivalent,
// sinkRunButtonOnly). The demo vault is the fixture; a sink writes into a temp COPY.

const DEMO = path.resolve(__dirname, "..", "demo-vault");
let tmp: string | null = null;
afterEach(() => { setFsProvider(null); if (tmp) { rmSync(tmp, { recursive: true, force: true }); tmp = null; } });

describe("run-graph --vault", () => {
  it("a Vault Folder node reads the demo vault headlessly — rows per note, frontmatter columns", async () => {
    const out = await runGraph(
      { nodes: [{ id: "v", type: "VaultFolderNode", init: { label: "Projects", folder: "Projects" } }], connections: [] },
      { vault: DEMO },
    );
    const cube = (out["Projects"] as { cube: CubeValue }).cube;
    expect(isCubeValue(cube)).toBe(true);
    expect(cube.columns[0]?.cells.length ?? 0).toBeGreaterThan(0);
    const names = cube.columns.map((c) => c.name);
    expect(names).toContain("name");
    expect(names).toContain("status");
  }, 30_000);

  it("--run arms and runs a named Write to Obsidian into a temp copy of the vault; nothing runs without it", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "solenoid-vault-"));
    cpSync(DEMO, tmp, { recursive: true });
    const graph = {
      nodes: [
        { id: "n", type: "NoteNode", init: { label: "Memo", body: "# Hello\n\nfrom the CLI" } },
        { id: "w", type: "WriteObsidianNode", init: { label: "Write memo", subfolder: "Notes" }, stringLiterals: { path: "CLI memo" } },
      ],
      connections: [{ source: "n", sourceOutput: "document", target: "w", targetInput: "in" }],
    };
    await runGraph(graph, { vault: tmp });
    expect(existsSync(path.join(tmp, "Notes", "CLI memo.md"))).toBe(false); // wiring never writes
    await runGraph(graph, { vault: tmp, run: "Write memo" });
    const written = readFileSync(path.join(tmp, "Notes", "CLI memo.md"), "utf8");
    expect(written).toContain("# Hello");
    await expect(runGraph(graph, { vault: tmp, run: "No such sink" })).rejects.toThrow(/no sink named/);
  }, 30_000);

  it("a wired `folder` drives Vault Folder to read that subfolder", async () => {
    const graph = {
      nodes: [
        { id: "src", type: "NoteNode", init: { label: "which", body: "---\nfolder: Projects\n---\n" } },
        { id: "v", type: "VaultFolderNode", init: { label: "Vault" } },
      ],
      connections: [{ source: "src", sourceOutput: "folder", target: "v", targetInput: "folder" }],
    };
    const out = await runGraph(graph, { vault: DEMO });
    const cube = (out["Vault"] as { cube: CubeValue }).cube;
    expect(isCubeValue(cube)).toBe(true);
    const folderCol = cube.columns.find((c) => c.name === "folder");
    expect(folderCol?.cells.length ?? 0).toBeGreaterThan(0);
    expect(folderCol?.cells.every((c) => c === "Projects")).toBe(true); // read only the wired subfolder
  }, 30_000);

  it("a wired `path` drives Import Obsidian to load that note (the wireable identity)", async () => {
    const graph = {
      nodes: [
        // A plain Note whose `path` frontmatter is the string source for Import's `path` input.
        { id: "src", type: "NoteNode", init: { label: "target", body: "---\npath: Projects/Kitchen remodel\n---\n" } },
        { id: "imp", type: "ImportObsidianNode", init: { label: "Loaded" } },
      ],
      connections: [{ source: "src", sourceOutput: "path", target: "imp", targetInput: "path" }],
    };
    const out = await runGraph(graph, { vault: DEMO });
    const imp = out["Loaded"] as Record<string, unknown>;
    expect(imp.path).toBe("Projects/Kitchen remodel.md"); // identity out (.md, matching a cube's path)
    expect(imp.status).toBe("active");                    // it adopted the loaded note's frontmatter
    expect(imp.priority).toBe(5);
  }, 30_000);

  it("a wired bare NAME resolves to the note anywhere in the vault (Obsidian-style)", async () => {
    const graph = {
      nodes: [
        { id: "src", type: "NoteNode", init: { label: "which", body: "---\npath: kitchen remodel\n---\n" } },
        { id: "imp", type: "ImportObsidianNode", init: { label: "Loaded" } },
      ],
      connections: [{ source: "src", sourceOutput: "path", target: "imp", targetInput: "path" }],
    };
    const out = await runGraph(graph, { vault: DEMO });
    const imp = out["Loaded"] as Record<string, unknown>;
    expect(imp.path).toBe("Projects/Kitchen remodel.md"); // "kitchen remodel" → the note in Projects/, case-insensitive
    expect(imp.status).toBe("active");
  }, 30_000);

  it("--run a Write Properties over the vault writes current scalar values back with no byte change", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "solenoid-vault-"));
    cpSync(DEMO, tmp, { recursive: true });
    const noteRel = path.join("Projects", "Kitchen remodel.md");
    const before = readFileSync(path.join(tmp, noteRel), "utf8");
    const graph = {
      nodes: [
        { id: "v", type: "VaultFolderNode", init: { label: "Projects", folder: "Projects" } },
        // Only `status` (a scalar) round-trips byte-for-byte; a list would re-render block-style.
        { id: "w", type: "WritePropertiesNode", init: { label: "Sync status" }, stringLiterals: { keys: "status" } },
      ],
      connections: [{ source: "v", sourceOutput: "cube", target: "w", targetInput: "rows" }],
    };
    await runGraph(graph, { vault: tmp });
    expect(readFileSync(path.join(tmp, noteRel), "utf8")).toBe(before); // wiring never writes
    await runGraph(graph, { vault: tmp, run: "Sync status" });
    expect(readFileSync(path.join(tmp, noteRel), "utf8")).toBe(before); // current value → unchanged
  }, 30_000);
});
