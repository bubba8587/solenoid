// [[C132]] workspaceTree
import { describe, it, expect } from "vitest";
import { searchLibrary, savedNodeLabel } from "../../src/graph/workspaceSearch";

const docs = [
  { id: "a", name: "Budget", folder: "Finance/2026", graph: { nodes: [
    { type: "SliderInputNode", init: { label: "Rate" } },
    { type: "LambdaNode", name: "lam1", init: {} },
    { type: "FormatControllerNode", init: { label: "Rate format" } },
  ] } },
  { id: "b", name: "Rates study", folder: "", graph: { nodes: [{ type: "SliderInputNode", init: { label: "Growth rate" } }] } },
];

describe("searchLibrary", () => {
  it("documents first, by name or folder, then cards in the other documents", () => {
    const hits = searchLibrary(docs, "b", "rate");
    expect(hits.map((h) => `${h.kind}:${h.label}`)).toEqual(["doc:Rates study", "node:Rate"]);
    expect(hits[1]).toMatchObject({ docId: "a", detail: "Finance › 2026 › Budget" });
  });

  it("a folder name finds the documents in it", () => {
    expect(searchLibrary(docs, null, "finance").map((h) => h.label)).toEqual(["Budget"]);
  });

  it("an untitled card shows its catalog name, as its header does, and keeps its saved name for the jump", () => {
    const hit = searchLibrary(docs, "b", "lambda").find((h) => h.kind === "node");
    expect(hit).toMatchObject({ label: "LAMBDA", nodeName: "lam1" });
  });

  it("Format Controllers stay out, as in the outline; an empty query finds nothing", () => {
    expect(searchLibrary(docs, "b", "format")).toEqual([]);
    expect(searchLibrary(docs, null, "  ")).toEqual([]);
  });

  it("caps the card results", () => {
    const many = [{ id: "m", name: "M", folder: "", graph: { nodes: Array.from({ length: 10 }, () => ({ type: "LambdaNode", init: {} })) } }];
    expect(searchLibrary(many, null, "lambda", 3)).toHaveLength(3);
  });

  it("savedNodeLabel trims, then falls back to the catalog name", () => {
    expect(savedNodeLabel({ type: "SeriesNode", init: { label: "  " } })).toBe("Range");
    expect(savedNodeLabel({ type: "NoSuchNode", init: {} })).toBe("No Such");
  });
});
