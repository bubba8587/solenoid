// [[C132]] workspaceTree
import { describe, it, expect } from "vitest";
import { touchRecent, recentDocs } from "../../src/graph/recentDocsStore";

describe("recent documents", () => {
  it("moves the opened document to the front, once", () => {
    expect(touchRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(touchRecent([], "a")).toEqual(["a"]);
  });
  it("keeps at most twelve", () => {
    const many = Array.from({ length: 12 }, (_, i) => `d${i}`);
    expect(touchRecent(many, "new")).toHaveLength(12);
    expect(touchRecent(many, "new")[11]).toBe("d10");
  });
  it("shows only ids that still name a document, in order, up to the cap", () => {
    const docs = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(recentDocs(["c", "gone", "a"], docs).map((d) => d.id)).toEqual(["c", "a"]);
    expect(recentDocs(["a", "b", "c"], docs, 2).map((d) => d.id)).toEqual(["a", "b"]);
  });
});
