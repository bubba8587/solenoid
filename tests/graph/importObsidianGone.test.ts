// [[B1]] obsidianBet, [[live-connections#The cache key]]
import { describe, it, expect, vi, afterEach } from "vitest";

const stat = vi.fn();
vi.mock("../../src/graph/fileBridge", async (orig) => ({ ...(await orig<object>()), vaultFileExists: (...a: unknown[]) => stat(...a) }));

const { ImportObsidianNode } = await import("../../src/graph/nodes/obsidian");
const { forgetAllNodes } = await import("../../src/graph/nodeStoreRegistry");

afterEach(() => { stat.mockReset(); forgetAllNodes(); });

describe("Import Obsidian Note: a note gone from the vault", () => {
  it("is flagged when the vault no longer has it, and the body stays", async () => {
    const node = new ImportObsidianNode({ fileName: "Daily/a.md", body: "kept" });
    stat.mockResolvedValue(false);
    await node.checkGone();
    expect(node.goneText()).toMatch(/Gone from the vault/);
    expect(node.body).toBe("kept");
  });

  it("clears once the note is back", async () => {
    const node = new ImportObsidianNode({ fileName: "Daily/a.md", body: "kept" });
    stat.mockResolvedValue(false);
    await node.checkGone();
    stat.mockResolvedValue(true);
    await node.checkGone();
    expect(node.goneText()).toBe(null);
  });

  it("a platform that can't read the vault never calls a note gone", async () => {
    const node = new ImportObsidianNode({ fileName: "Daily/a.md", body: "kept" });
    stat.mockResolvedValue(null);
    await node.checkGone();
    expect(node.goneText()).toBe(null);
  });

  it("a card with no note picked is never gone", async () => {
    const node = new ImportObsidianNode({});
    await node.checkGone();
    expect(stat).not.toHaveBeenCalled();
    expect(node.goneText()).toBe(null);
  });
});
