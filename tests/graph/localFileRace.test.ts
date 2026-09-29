// [[C23]] calcModes
import { describe, it, expect, vi } from "vitest";

const held: { name: string; release: (handle: string) => void }[] = [];
const dropped: string[] = [];

vi.mock("../../src/graph/fileBridge", async (orig) => ({ ...(await orig<object>()), isDesktop: () => true }));
vi.mock("../../src/graph/ipcBridge", async (orig) => ({
  ...(await orig<object>()),
  engineAvailable: () => true,
  ipcInvoke: (_cmd: string, args: { name: string }) =>
    new Promise<string>((resolve) => held.push({ name: args.name, release: resolve })),
}));
vi.mock("../../src/graph/demoVault", async (orig) => ({ ...(await orig<object>()), getCsvFolder: () => "/data" }));
vi.mock("../../src/graph/frameBackend", async (orig) => ({
  ...(await orig<object>()),
  dropFrameRef: (r: { __frameRef: string }) => { dropped.push(r.__frameRef); },
  collectPreview: async () => ({ __frame: true, columns: [] }),
}));

const { LocalFileNode } = await import("../../src/graph/nodes/connection");
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("Local File answers for its current file only", () => {
  it("a Parquet read that lands after a newer one never frees or replaces the newer handle", async () => {
    const n = new LocalFileNode({ fileName: "a.parquet" });
    void n.data();
    n.fileName = "b.parquet";
    const pB = n.data();
    expect(held.map((h) => h.name)).toEqual(["a.parquet", "b.parquet"]);
    held[1].release("hB");
    await pB;
    held[0].release("hA");
    await settle();
    expect(dropped).toEqual(["hA"]);
    const out = await n.data();
    expect((out.frame as { __frameRef: string }).__frameRef).toBe("hB");
  });
});
