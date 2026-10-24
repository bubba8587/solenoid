// [[C23]] calcModes
import { describe, it, expect, vi } from "vitest";

const held: { name: string; release: (columns: unknown[]) => void; refuse: (e: unknown) => void }[] = [];

vi.mock("../../src/graph/fileBridge", async (orig) => ({ ...(await orig<object>()), isDesktop: () => true }));
vi.mock("../../src/graph/ipcBridge", async (orig) => ({
  ...(await orig<object>()),
  ipcInvoke: (_cmd: string, args: { name: string }) =>
    new Promise<unknown[]>((resolve, reject) => held.push({ name: args.name, release: resolve, refuse: reject })),
}));
vi.mock("../../src/graph/demoVault", async (orig) => ({ ...(await orig<object>()), getCsvFolder: () => "/data" }));

const { LocalFileNode } = await import("../../src/graph/nodes/connection");
const { solError } = await import("../../src/graph/errorValue");
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

  it("a Parquet column the reader refuses answers the reader's own error, not #REF!", async () => {
    held.length = 0;
    const n = new LocalFileNode({ fileName: "c.parquet" });
    const out = n.data();
    held[0].refuse(solError("#VALUE!", 'Column "tags" holds values Solenoid can\'t read as a table column'));
    expect((await out).frame).toMatchObject({ code: "#VALUE!" });
  });

  it("a file name that leaves the data folder is refused before anything is read", async () => {
    held.length = 0;
    for (const fileName of ["../../.ssh/id_rsa.parquet", "/etc/passwd.csv", "C:\\x.parquet", "\\\\host\\s\\a.parquet", "a/../../b.csv"]) {
      const out = await new LocalFileNode({ fileName }).data();
      expect(held).toEqual([]);
      if (fileName.endsWith(".parquet")) expect(out.frame).toMatchObject({ code: "#REF!" });
    }
  });
});

