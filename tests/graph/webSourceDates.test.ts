// [[C44]] dateSerials, [[live-connections#Dates and column types of a file]]
// Web Source reads a CSV's dates in its Dates order and takes the popup's column type picks, as Local File does.
import { afterEach, describe, it, expect } from "vitest";
import { WebSourceNode } from "../../src/graph/nodes/connection";
import { extractInit } from "../../src/graph/nodeInit";
import type { FrameValue } from "../../src/graph/frame";

const csv = "When,Zip,Amt\n1/2/2026,02134,5\n3/4/2026,10001,7\n";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function read(init: ConstructorParameters<typeof WebSourceNode>[0]): Promise<{ node: WebSourceNode; frame: FrameValue }> {
  globalThis.fetch = (async () => ({ ok: true, status: 200, statusText: "OK", headers: { get: () => "text/csv" }, text: async () => csv })) as unknown as typeof fetch;
  const node = new WebSourceNode({ url: "https://example.com/data.csv", ...init });
  (node as unknown as { inflightKey: string }).inflightKey = "k";
  const out = await (node as unknown as { fetchFrame(ref: string, key: string): Promise<{ frame: FrameValue }> }).fetchFrame(node.url, "k");
  return { node, frame: out.frame };
}
const col = (f: FrameValue, n: string) => f.columns.find((c) => c.name === n)!;

describe("Web Source's dates and column types", () => {
  it("Auto leaves numbers-alone dates as text; MDY and DMY read them as dates", async () => {
    expect(col((await read({})).frame, "When").type).toBe("string");
    const mdy = col((await read({ dateOrder: "MDY" })).frame, "When");
    const dmy = col((await read({ dateOrder: "DMY" })).frame, "When");
    expect([mdy.type, dmy.type]).toEqual(["date", "date"]);
    expect(mdy.values[0]).toBe(Date.UTC(2026, 0, 2) / 86400000 + 25569);
    expect(dmy.values[0]).toBe(Date.UTC(2026, 1, 1) / 86400000 + 25569);
  });

  it("a picked column type reads the column again from its text, and both settings save", async () => {
    const plain = await read({});
    expect(col(plain.frame, "Zip").values).toEqual([2134, 10001]);
    expect(plain.node.readTypes.Zip).toBe("number");
    const { node, frame } = await read({ dateOrder: "MDY", columnTypes: { Zip: "string", Bad: "nope" as never } });
    expect(col(frame, "Zip").values).toEqual(["02134", "10001"]);
    expect(node.columnTypes).toEqual({ Zip: "string" });
    expect(extractInit(node)).toMatchObject({ dateOrder: "MDY", columnTypes: { Zip: "string" } });
  });
});
