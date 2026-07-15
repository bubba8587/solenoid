import { describe, it, expect } from "vitest";
import { WriteObsidianNode, ImportObsidianNode } from "./obsidian";
import { NoteNode } from "./annotation";
import { extractInit } from "../copyPaste";
import { makeDocument, isDocumentValue } from "../documentValue";

// The vitest env is `node` — isDesktop() is false, so run() short-circuits at the
// "Desktop app only" guard and never touches obsidianWrite / the filesystem. These
// tests pin the persistence + arming discipline, which is the safety-critical half.

describe("WriteObsidianNode persistence + arming", () => {
  it("persists fileName + subfolder through extractInit, but NEVER persists enabled", () => {
    const n = new WriteObsidianNode({ fileName: "Weekly Report", subfolder: "reports/2026" });
    n.enabled = true;
    const init = extractInit(n);
    expect(init.fileName).toBe("Weekly Report");
    expect(init.subfolder).toBe("reports/2026");
    expect(init.enabled).toBeUndefined();
    const reloaded = new WriteObsidianNode(init);
    expect(reloaded.fileName).toBe("Weekly Report");
    expect(reloaded.subfolder).toBe("reports/2026");
    expect(reloaded.enabled).toBe(false); // every load starts disarmed
  });

  it("data() only caches the document for the preview", () => {
    const doc = makeDocument("# Note\n\nbody", {}, { title: "T" });
    const n = new WriteObsidianNode();
    const out = n.data({ in: [doc] });
    expect(out).toEqual({});
    expect(n.cachedDoc).toBe(doc);
  });
});

describe("WriteObsidianNode.run() guards", () => {
  it("refuses when disarmed (before even checking the vault)", async () => {
    const n = new WriteObsidianNode({ fileName: "x" });
    n.data({ in: [makeDocument("body")] });
    await n.run();
    expect(n.status).toBe("error");
    expect(n.statusMessage).toMatch(/arm/i);
  });

  it("armed but off-desktop → the desktop-only guard", async () => {
    const n = new WriteObsidianNode({ fileName: "x" });
    n.enabled = true;
    n.data({ in: [makeDocument("body")] });
    await n.run();
    expect(n.status).toBe("error");
    expect(n.statusMessage).toMatch(/desktop/i);
  });
});

describe("ImportObsidianNode", () => {
  it("is a Note (inherits the frontmatter-socket + document machinery)", () => {
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
    const out = n.data();
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
