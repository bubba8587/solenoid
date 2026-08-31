import { describe, it, expect, afterEach } from "vitest";
import { docMetaStore } from "../../src/graph/docMetaStore";
import { writeTextForm, readTextForm } from "../../src/graph/textForm";
import type { SavedGraph } from "../../src/graph/persistence";

describe("docMetaStore (F-2)", () => {
  afterEach(() => docMetaStore.setDocMeta(null));

  it("serializes author + tags, trimming and dropping empties", () => {
    docMetaStore.setDocMeta({ author: "  Ada  ", tags: [" x ", "", "y"] });
    expect(docMetaStore.author()).toBe("  Ada  "); // stored raw for editing
    expect(docMetaStore.docMeta()).toEqual({ author: "Ada", tags: ["x", "y"] }); // trimmed for save
  });

  it("is undefined when nothing meaningful is set", () => {
    docMetaStore.setDocMeta(null);
    expect(docMetaStore.docMeta()).toBeUndefined();
    docMetaStore.setAuthor("   ");
    docMetaStore.setTags([" ", ""]);
    expect(docMetaStore.docMeta()).toBeUndefined();
  });

  it("setDocMeta(null) clears prior values", () => {
    docMetaStore.setDocMeta({ author: "Ada", tags: ["x"] });
    docMetaStore.setDocMeta(null);
    expect(docMetaStore.author()).toBe("");
    expect(docMetaStore.tags()).toEqual([]);
  });

  it("serializes author-only or tags-only", () => {
    docMetaStore.setDocMeta({ author: "Ada" });
    expect(docMetaStore.docMeta()).toEqual({ author: "Ada" });
    docMetaStore.setDocMeta({ tags: ["q3"] });
    expect(docMetaStore.docMeta()).toEqual({ tags: ["q3"] });
  });
});

describe("text-form carries meta in the sidecar", () => {
  const base: SavedGraph = { v: 2, nodes: [], connections: [] };

  it("survives a write → read round-trip", () => {
    const g: SavedGraph = { ...base, meta: { author: "Ada", tags: ["finance", "q3"] } };
    const back = readTextForm(writeTextForm(g));
    expect(back.meta).toEqual({ author: "Ada", tags: ["finance", "q3"] });
  });

  it("is absent when the graph declares none", () => {
    const back = readTextForm(writeTextForm(base));
    expect(back.meta).toBeUndefined();
  });

  // These two were set in buildRawSavedGraph but dropped by the text-form round-trip
  // (serializeGraph goes through it) until 2026-07-06 — a real persistence gap.
  it("preserves comments (node-anchored) through the round-trip", () => {
    const g: SavedGraph = {
      ...base,
      comments: [{ id: "c1", nodeId: "n1", author: "Ada", text: "check this", resolved: false }],
    };
    const back = readTextForm(writeTextForm(g));
    expect(back.comments).toEqual(g.comments);
  });

  it("preserves reportPalette through the round-trip", () => {
    const g: SavedGraph = { ...base, reportPalette: { base: "Muted", overrides: { gold: "#ff00ff" } } };
    const back = readTextForm(writeTextForm(g));
    expect(back.reportPalette).toEqual(g.reportPalette);
  });
});
