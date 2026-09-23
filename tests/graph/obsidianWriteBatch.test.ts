// [[B1]] obsidianBet
import { describe, it, expect, vi, beforeEach } from "vitest";

const written = new Map<string, string>();
const assets: string[] = [];
vi.mock("../../src/graph/fileBridge", () => ({
  hasFs: () => true,
  joinPath: async (...parts: string[]) => parts.join("/"),
  ensureDir: async () => {},
  writeTextFilePath: async (p: string, text: string) => { written.set(p, text); },
  writeBinaryFilePath: async (p: string) => { assets.push(p); },
  readTextFilePath: async () => { throw new Error("missing"); },
}));

const { writeDocumentToVault } = await import("../../src/graph/obsidianWrite");
const { makeDocument } = await import("../../src/graph/documentValue");
const { formatAnnotationStore } = await import("../../src/graph/formatAnnotationStore");

const opts = { vault: "/v", subfolder: "", assetSubfolder: "", name: "Report", refSources: new Map<string, string>() };

describe("writing a batch document to the vault", () => {
  beforeEach(() => { written.clear(); assets.length = 0; });

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

  it("pages that sanitize or case-fold to one file name never overwrite each other", async () => {
    const doc = makeDocument("", {}, undefined, undefined, { pages: [{ name: "Q1?", body: "a" }, { name: "q1", body: "b" }, { name: "Report-1", body: "c" }, { name: "", body: "d" }] });
    const res = await writeDocumentToVault(doc, opts);
    expect(res.pages).toBe(4);
    expect([...written.keys()]).toEqual(["/v/Q1.md", "/v/q1 (2).md", "/v/Report-1.md", "/v/Report-4.md"]);
    expect(written.get("/v/Q1.md")).toBe("a");
  });

  it("an attached image is written as an asset whose embed survives a link-breaking page name", async () => {
    const png = { __image: true, src: "data:image/png;base64,iVBORw0KGgo=", height: 10 };
    const doc = makeDocument("", { pic: png }, undefined, undefined, { pages: [{ name: "Q#1 [a]", body: "`=pic`" }, { name: "Q1 a", body: "`=pic`" }] });
    const res = await writeDocumentToVault(doc, opts);
    expect(assets).toEqual(["/v/Q1 a-pic.png", "/v/Q1 a-pic (2).png"]);
    expect(res.assets).toBe(2);
    expect(written.get("/v/Q#1 [a].md")).toBe("![[Q1 a-pic.png]]");
    expect(written.get("/v/Q1 a.md")).toBe("![[Q1 a-pic (2).png]]");
  });

  it("a web image is linked, its alt and URL escaped so the markdown holds", async () => {
    const img = { __image: true, src: "https://e.com/a b(1).png", height: 10, alt: "x [y]\nz" };
    await writeDocumentToVault(makeDocument("`=img`", { img }), opts);
    expect(written.get("/v/Report.md")).toBe("![x \\[y\\] z](https://e.com/a%20b%281%29.png)");
    expect(assets).toEqual([]);
  });

  it("an image from any other scheme writes nothing", async () => {
    const img = { __image: true, src: "file:///etc/passwd", height: 10 };
    await writeDocumentToVault(makeDocument("a `=img` b", { img }), opts);
    expect(written.get("/v/Report.md")).toBe("a  b");
  });
});
