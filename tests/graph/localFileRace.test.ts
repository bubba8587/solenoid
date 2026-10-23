// [[C23]] calcModes
import { describe, it, expect, vi } from "vitest";

const held: { name: string; release: (columns: unknown[]) => void }[] = [];

vi.mock("../../src/graph/fileBridge", async (orig) => ({ ...(await orig<object>()), isDesktop: () => true }));
vi.mock("../../src/graph/ipcBridge", async (orig) => ({
  ...(await orig<object>()),
  ipcInvoke: (_cmd: string, args: { name: string }) =>
    new Promise<unknown[]>((resolve) => held.push({ name: args.name, release: resolve })),
}));
vi.mock("../../src/graph/demoVault", async (orig) => ({ ...(await orig<object>()), getCsvFolder: () => "/data" }));

const { LocalFileNode } = await import("../../src/graph/nodes/connection");
const settle = () => new Promise((r) => setTimeout(r, 0));
const file = (tag: string) => [{ name: "from", type: "string", values: [tag] }];

describe("Local File answers for its current file only", () => {
  it("a Parquet read that lands after a newer one never replaces the newer frame", async () => {
    const n = new LocalFileNode({ fileName: "a.parquet" });
    void n.data();
    n.fileName = "b.parquet";
    const pB = n.data();
    expect(held.map((h) => h.name)).toEqual(["a.parquet", "b.parquet"]);
    held[1].release(file("b"));
    await pB;
    held[0].release(file("a"));
    await settle();
    const out = await n.data();
    expect((out.frame as { columns: { values: string[] }[] }).columns[0].values).toEqual(["b"]);
  });
});
