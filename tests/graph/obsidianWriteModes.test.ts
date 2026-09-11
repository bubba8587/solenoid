import { describe, it, expect } from "vitest";
import { mergeNoteText } from "../../src/graph/obsidianWrite";
import { WriteObsidianNode } from "../../src/graph/nodes/obsidian";
import { extractInit } from "../../src/graph/copyPaste";
import { beginMarker, END_MARKER } from "../../src/graph/managedBlock";
import { makeDocument } from "../../src/graph/documentValue";

// Bundle item C: overwrite | append | block, and the wireable `path` target on the writer.

describe("mergeNoteText", () => {
  it("overwrite: the note is the document; a missing note is created in every mode", () => {
    expect(mergeNoteText("old", "new", "overwrite", "W")).toBe("new");
    expect(mergeNoteText(null, "new", "append", "W")).toBe("new");
    expect(mergeNoteText(null, "new", "block", "W")).toBe(`${beginMarker("W")}\nnew\n${END_MARKER}\n`);
  });
  it("append: one blank line, then the document; the existing text is untouched", () => {
    expect(mergeNoteText("# Note\n\nbody\n\n", "added", "append", "W")).toBe("# Note\n\nbody\n\nadded");
  });
  it("block: the writer's span is replaced; a refused splice throws with the reason", () => {
    const B = beginMarker("Weekly");
    const before = `mine\n${B}\nold\n${END_MARKER}\nalso mine\n`;
    expect(mergeNoteText(before, "fresh", "block", "Weekly")).toBe(`mine\n${B}\nfresh\n${END_MARKER}\nalso mine\n`);
    expect(() => mergeNoteText(before, "%% no %%", "block", "Weekly")).toThrow(/Refused/);
  });
});

describe("WriteObsidianNode modes + path target", () => {
  it("mode persists through extractInit, defaults to overwrite, a stale value falls back; inputs are in + path", () => {
    expect(new WriteObsidianNode().mode).toBe("overwrite");
    expect(extractInit(new WriteObsidianNode({ mode: "block" }) as never).mode).toBe("block");
    expect(new WriteObsidianNode({ mode: "nope" as never }).mode).toBe("overwrite");
    expect(Object.keys(new WriteObsidianNode().inputs)).toEqual(["in", "path"]);
  });
  it("renderedTarget resolves the wired path: a folder/name splits, the folder prepends to the subfolder", () => {
    const n = new WriteObsidianNode({ subfolder: "Ops" });
    n.data({ in: [makeDocument("x")], path: ["Plans/Q1 review"] });
    expect(n.renderedTarget()).toEqual({ name: "Q1 review", subfolder: "Ops/Plans" });
  });
  it("a bare name uses the node's subfolder; the `path` literal fills in when the input is unwired", () => {
    const n = new WriteObsidianNode({ subfolder: "Trip letters" });
    n.stringLiterals.path = "Welcome";
    n.data({ in: [makeDocument("x")] });
    expect(n.renderedTarget()).toEqual({ name: "Welcome", subfolder: "Trip letters" });
  });
});
