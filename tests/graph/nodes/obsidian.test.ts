import { describe, it, expect } from "vitest";
import { WriteObsidianNode, ImportObsidianNode } from "../../../src/graph/nodes/obsidian";
import { NoteNode } from "../../../src/graph/nodes/annotation";
import { extractInit } from "../../../src/graph/copyPaste";
import { makeDocument, isDocumentValue } from "../../../src/graph/documentValue";

// The vitest env is `node` — isDesktop() is false, so run() short-circuits at the
// "Desktop app only" guard and never touches obsidianWrite / the filesystem. These
// tests pin the persistence + arming discipline, which is the safety-critical half.

describe("WriteObsidianNode persistence + arming", () => {
  it("persists subfolder through extractInit, keeps the path literal, but NEVER persists enabled", () => {
    const n = new WriteObsidianNode({ subfolder: "reports/2026" });
    n.stringLiterals.path = "Weekly Report";
    n.enabled = true;
    const init = extractInit(n);
    expect(init.subfolder).toBe("reports/2026");
    expect(init.enabled).toBeUndefined();
    const reloaded = new WriteObsidianNode(init);
    expect(reloaded.subfolder).toBe("reports/2026");
    expect(reloaded.enabled).toBe(false); // every load starts disarmed
    expect(new WriteObsidianNode().stringLiterals).toEqual({ path: "", keys: "" }); // path (Note) + keys (Properties)
  });

  it("data() caches the document and resolves the path for the preview; the Note plan is empty", () => {
    const doc = makeDocument("# Note\n\nbody", {}, { title: "T" });
    const n = new WriteObsidianNode({ subfolder: "Notes" });
    n.stringLiterals.path = "Memo";
    const out = n.data({ in: [doc] });
    expect(out).toEqual({ plan: null }); // Note target: no cube, no plan
    expect(n.cachedDoc).toBe(doc);
    expect(n.resolveMode()).toBe("note");
    expect(n.renderedTarget()).toEqual({ name: "Memo", subfolder: "Notes" });
  });
});

describe("WriteObsidianNode.run() guards", () => {
  it("refuses when disarmed (before even checking the vault)", async () => {
    const n = new WriteObsidianNode();
    n.stringLiterals.path = "x";
    n.data({ in: [makeDocument("body")] });
    await n.run();
    expect(n.status).toBe("error");
    expect(n.statusMessage).toMatch(/arm/i);
  });

  it("armed but off-desktop → the desktop-only guard", async () => {
    const n = new WriteObsidianNode();
    n.stringLiterals.path = "x";
    n.enabled = true;
    n.data({ in: [makeDocument("body")] });
    await n.run();
    expect(n.status).toBe("error");
    expect(n.statusMessage).toMatch(/desktop/i);
  });
});

describe("ImportObsidianNode", () => {
  it("is a Note (inherits the frontmatter-socket + document machinery)", async () => {
    const n = new ImportObsidianNode({ body: "---\ntitle: Weekly\ncount: 5\n---\n# Body" });
    expect(n).toBeInstanceOf(NoteNode); // reads as a note everywhere (embeds, export, minimap)
    // frontmatter → typed OUTPUT sockets
    expect(n.fieldKeys()).toEqual(["title", "count"]);
    expect(n.outputs.title).toBeTruthy();
    expect(n.outputs.count).toBeTruthy();
    expect(n.outputs.document).toBeTruthy();
    // body renders below the stripped frontmatter
    expect(n.renderBody.trim()).toBe("# Body");
    // data() emits each field + the whole note as a document
    const out = await n.data();
    expect(out.title).toBe("Weekly");
    expect(out.count).toBe(5);
    expect(isDocumentValue(out.document)).toBe(true);
  });

  it("persists the source fileName + inherited note fields through extractInit", () => {
    const n = new ImportObsidianNode({ fileName: "notes/weekly.md", body: "---\na: 1\n---\nhi", color: "violet" });
    const init = extractInit(n);
    expect(init.fileName).toBe("notes/weekly.md");
    expect(init.body).toBe("---\na: 1\n---\nhi");
    const reloaded = new ImportObsidianNode(init);
    expect(reloaded.fileName).toBe("notes/weekly.md");
    expect(reloaded.fieldKeys()).toEqual(["a"]); // frontmatter sockets rebuild from the persisted body
  });
});

describe("ImportObsidianNode refresh cadence (bundle I)", () => {
  it("refreshMinutes persists through extractInit, defaults to 0, never negative", () => {
    expect(new ImportObsidianNode().refreshMinutes).toBe(0);
    expect(extractInit(new ImportObsidianNode({ refreshMinutes: 15 }) as never).refreshMinutes).toBe(15);
    expect(new ImportObsidianNode({ refreshMinutes: -3 }).refreshMinutes).toBe(0);
  });
});
