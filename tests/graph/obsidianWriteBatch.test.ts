// [[B1]] obsidianBet
import { describe, it, expect, vi, beforeEach } from "vitest";

const written = new Map<string, string>();
vi.mock("../../src/graph/fileBridge", () => ({
  hasFs: () => true,
  joinPath: async (...parts: string[]) => parts.join("/"),
  ensureDir: async () => {},
  writeTextFilePath: async (p: string, text: string) => { written.set(p, text); },
  writeBinaryFilePath: async () => {},
  readTextFilePath: async () => { throw new Error("missing"); },
}));

const { writeDocumentToVault } = await import("../../src/graph/obsidianWrite");
const { makeDocument } = await import("../../src/graph/documentValue");
const { formatAnnotationStore } = await import("../../src/graph/formatAnnotationStore");

const opts = { vault: "/v", subfolder: "", assetSubfolder: "", name: "Report", refSources: new Map<string, string>() };

describe("writing a batch document to the vault", () => {
  beforeEach(() => written.clear());

  it("a merge with no rows writes no note", async () => {
    const res = await writeDocumentToVault(makeDocument("", {}, undefined, undefined, { pages: [] }), opts);
    expect(res.pages).toBe(0);
    expect(written.size).toBe(0);
  });

  it("pages without a usable name take the sink's name, numbered", async () => {
    const doc = makeDocument("", {}, undefined, undefined, { pages: [{ name: "", body: "a" }, { name: "???", body: "b" }, { name: "Kept", body: "c" }] });
    await writeDocumentToVault(doc, opts);
    expect([...written.keys()].sort()).toEqual(["/v/Kept.md", "/v/Report-1.md", "/v/Report-2.md"]);
  });

  it("a single document writes under the sink's name", async () => {
    await writeDocumentToVault(makeDocument("hello"), opts);
    expect([...written.keys()]).toEqual(["/v/Report.md"]);
  });

  it("a plain value writes in its Report's format pick", async () => {
    formatAnnotationStore.set("rep1", "price", { format: "decimal", unit: "none", decimalDigits: 2 });
    await writeDocumentToVault(makeDocument("Price: `=price`", { price: 3.14159 }, undefined, "rep1"), opts);
    expect(written.get("/v/Report.md")).toContain("Price: 3.14");
    expect(written.get("/v/Report.md")).not.toContain("3.1416");
  });
});
