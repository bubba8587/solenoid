// [[C103]] untrustedContentSeams, [[live-connections#Excel workbooks]]
// Local File and Web Source read an Excel workbook's named Table: the answers Excel saved, typed by their cells, a
// formula Excel never calculated an error naming its cell, and the popup's type picks over the cells' text.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { LocalFileNode, WebSourceNode, isWorkbookName } from "../../src/graph/nodes/connection";
import { setFsProvider, type FsProvider } from "../../src/graph/fileBridge";
import { settingsStore } from "../../src/graph/settingsStore";
import { connectionStore } from "../../src/graph/connectionStore";
import { extractInit } from "../../src/graph/nodeInit";
import { isSolError, type SolError } from "../../src/graph/errorValue";
import type { FrameValue } from "../../src/graph/frame";

const FIXTURES = new URL("../../fixtures/xlsx/", import.meta.url);
const book = (name: string) => new Uint8Array(readFileSync(new URL(name, FIXTURES)));
const col = (f: FrameValue, n: string) => f.columns.find((c) => c.name === n)!;

describe("a workbook by its name", () => {
  it("is an .xlsx or .xlsm, before any query", () => {
    expect(["a.xlsx", "B.XLSM", "https://x/y.xlsx?download=1", "a.xls", "a.csv", "xlsx"].map(isWorkbookName))
      .toEqual([true, true, true, false, false, false]);
  });
});

describe("Local File over a workbook", () => {
  const ROOT = "/data";
  const provider = {
    readBinary: async (p: string) => book(p.slice(ROOT.length + 1)),
    readDir: async () => readdirSync(FIXTURES).map((name) => ({ name, isDirectory: false, isFile: true })),
    join: async (...parts: string[]) => parts.join("/"),
  } as unknown as FsProvider;
  afterEach(() => { setFsProvider(null); settingsStore.set("csvFolder", ""); });

  const read = async (init: ConstructorParameters<typeof LocalFileNode>[0]) => {
    setFsProvider(provider);
    settingsStore.set("csvFolder", ROOT);
    const node = new LocalFileNode(init);
    return { node, out: await node.data() };
  };

  it("lists the Tables and asks for one when there are several", async () => {
    const { node, out } = await read({ fileName: "sales.xlsx" });
    expect(out.frame).toBeNull();
    expect(node.xlsxTables.map((t) => [t.name, t.sheet, t.rows])).toEqual([["Sales", "Report", 11], ["Regions", "Lookup", 2]]);
    expect(connectionStore.getState(node.id)).toMatchObject({ status: "idle", message: "Pick a Table: Sales, Regions" });
  });

  it("reads the picked Table, typed by its cells, and saves the pick", async () => {
    const { node, out } = await read({ fileName: "sales.xlsx", tableName: "Sales" });
    const f = out.frame as FrameValue;
    expect(f.columns.map((c) => [c.name, c.type])).toEqual([
      ["region", "string"], ["amount", "number"], ["when", "date"], ["paid", "logical"], ["code", "string"], ["calc", "number"],
    ]);
    expect(col(f, "code").values[0]).toBe("02134");
    expect(col(f, "amount").values.slice(0, 3)).toEqual([100, 250.5, null]);
    const unrun = col(f, "calc").values[2] as SolError;
    expect(isSolError(unrun) && unrun.message).toBe("F6 holds a formula (=B6*2) Excel never calculated. Open the workbook in Excel and save it.");
    expect(connectionStore.getState(node.id)).toMatchObject({ status: "ok", rows: 11, cols: 6 });
    expect(extractInit(node)).toMatchObject({ fileName: "sales.xlsx", tableName: "Sales" });
  });

  it("reads the only Table without a pick", async () => {
    const { out } = await read({ fileName: "mixed.xlsx" });
    expect((out.frame as FrameValue).columns.map((c) => c.name)).toEqual(["value"]);
  });

  it("a picked type reads the column again from the cells' text, and an error cell stays the error", async () => {
    const { node, out } = await read({ fileName: "sales.xlsx", tableName: "Sales", columnTypes: { amount: "string", calc: "string" } });
    const f = out.frame as FrameValue;
    expect(col(f, "amount").values.slice(0, 3)).toEqual(["100", "250.5", "n/a"]);
    expect(col(f, "amount").values[9]).toBe("eleven");
    expect(isSolError(col(f, "calc").values[2])).toBe(true);
    expect(node.readTypes).toMatchObject({ amount: "number", calc: "number" });
  });

  it("a Table the workbook doesn't have is the card's error, naming the ones it has", async () => {
    const { out } = await read({ fileName: "sales.xlsx", tableName: "Orders" });
    expect(isSolError(out.frame) && (out.frame as SolError).message).toBe("No Table named \"Orders\". The workbook has: Sales, Regions");
  });

  it("a pattern reads the same Table from every workbook, naming the ones without it", async () => {
    const { node, out } = await read({ fileName: "*.xlsx", tableName: "Sales" });
    const f = out.frame as FrameValue;
    expect(f.columns[0]).toMatchObject({ name: "File", values: Array(11).fill("sales.xlsx") });
    expect(connectionStore.getState(node.id).message).toMatch(/^3 didn't read: dates1904\.xlsx \(No Table named "Sales"/);
  });
});

describe("Web Source over a workbook", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  const fetchOf = async (url: string, bytes: Uint8Array, init: ConstructorParameters<typeof WebSourceNode>[0] = {}) => {
    const calls: string[] = [];
    globalThis.fetch = (async (u: string) => {
      calls.push(u);
      return {
        ok: true, status: 200, statusText: "OK", headers: { get: () => "application/octet-stream" },
        text: async () => new TextDecoder("latin1").decode(bytes),
        arrayBuffer: async () => bytes.slice().buffer,
      };
    }) as unknown as typeof fetch;
    const node = new WebSourceNode({ url, ...init });
    (node as unknown as { inflightKey: string }).inflightKey = "k";
    const out = await (node as unknown as { fetchFrame(ref: string, key: string): Promise<{ frame: FrameValue | null }> }).fetchFrame(url, "k");
    return { node, frame: out.frame, calls };
  };

  it("fetches an .xlsx address as bytes and reads its Table", async () => {
    const { node, frame, calls } = await fetchOf("https://example.com/book.xlsx", book("sales.xlsx"), { tableName: "regions" });
    expect(calls).toHaveLength(1);
    expect(frame!.columns.map((c) => c.name)).toEqual(["region", "manager"]);
    expect(node.xlsxTables).toHaveLength(2);
    expect(extractInit(node)).toMatchObject({ tableName: "regions" });
  });

  it("knows a workbook behind an address with no extension by its first bytes", async () => {
    const { frame, calls } = await fetchOf("https://example.com/share/abc", book("mixed.xlsx"));
    expect(calls).toHaveLength(2);
    expect(frame!.columns.map((c) => c.name)).toEqual(["value"]);
  });

  it("a workbook with no Tables says how to make one", async () => {
    const { node, frame } = await fetchOf("https://example.com/plain.xlsx", book("no-tables.xlsx"));
    expect(frame).toBeNull();
    expect(connectionStore.getState(node.id).message).toMatch(/^This workbook has no named Tables\. In Excel, select the data and press Ctrl\+T/);
  });
});
