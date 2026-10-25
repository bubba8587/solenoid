// [[C23]] calcModes
import { describe, it, expect, vi } from "vitest";

const held: { name: string; release: (bytes: ArrayBuffer) => void; refuse: (e: unknown) => void }[] = [];

vi.mock("../../src/graph/fileBridge", async (orig) => ({ ...(await orig<object>()), isDesktop: () => true }));
vi.mock("../../src/graph/ipcBridge", async (orig) => ({
  ...(await orig<object>()),
  ipcInvoke: (_cmd: string, args: { name: string }) =>
    new Promise<ArrayBuffer>((resolve, reject) => held.push({ name: args.name, release: resolve, refuse: reject })),
}));
vi.mock("../../src/graph/demoVault", async (orig) => ({ ...(await orig<object>()), getCsvFolder: () => "/data" }));

const { LocalFileNode } = await import("../../src/graph/nodes/connection");
const { solError } = await import("../../src/graph/errorValue");
const settle = () => new Promise((r) => setTimeout(r, 0));
const { encodeBinary } = await import("../../src/graph/binaryCells");

/** One text column as the shell's Parquet read sends it: the columnar hand-off's one buffer (`Columnar::to_bytes`). */
function file(tag: string): ArrayBuffer {
  const b = encodeBinary({ __frame: true, columns: [{ name: "from", type: "string", values: [tag] }] }, false);
  const schema = new TextEncoder().encode(JSON.stringify(b.schema));
  const strs = new TextEncoder().encode(b.strs);
  const pad = (8 - ((16 + schema.length) % 8)) % 8;
  const out = new Uint8Array(16 + schema.length + pad + b.nums.length * 8 + b.lens.length * 4 + b.tags.length + strs.length);
  new Uint32Array(out.buffer, 0, 4).set([schema.length, b.tags.length, b.lens.length, strs.length]);
  let at = 16;
  out.set(schema, at); at += schema.length + pad;
  out.set(new Uint8Array(b.nums.buffer), at); at += b.nums.length * 8;
  out.set(new Uint8Array(b.lens.buffer, b.lens.byteOffset, b.lens.byteLength), at); at += b.lens.length * 4;
  out.set(b.tags, at); at += b.tags.length;
  out.set(strs, at);
  return out.buffer;
}

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
});
