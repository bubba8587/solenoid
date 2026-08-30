import { describe, it, expect } from "vitest";
import { diffLines, hasChanges } from "../../src/graph/textDiff";

describe("diffLines", () => {
  it("reports an unchanged document as all-same", () => {
    const text = "a\nb\nc";
    const d = diffLines(text, text);
    expect(d.map((l) => l.kind)).toEqual(["same", "same", "same"]);
    expect(hasChanges(d)).toBe(false);
  });

  it("marks an inserted line as add, keeping context same", () => {
    const d = diffLines("a\nc", "a\nb\nc");
    expect(d).toEqual([
      { kind: "same", text: "a" },
      { kind: "add", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  it("marks a removed line as del", () => {
    const d = diffLines("a\nb\nc", "a\nc");
    expect(d).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  it("shows a changed line as del + add", () => {
    const d = diffLines("a\nold\nc", "a\nnew\nc");
    expect(d.filter((l) => l.kind === "del")).toEqual([{ kind: "del", text: "old" }]);
    expect(d.filter((l) => l.kind === "add")).toEqual([{ kind: "add", text: "new" }]);
    expect(d.filter((l) => l.kind === "same")).toHaveLength(2);
  });

  it("keeps a common tail aligned across an unbalanced middle", () => {
    const d = diffLines("h\n1\n2\n3\nt", "h\nx\nt");
    expect(d[0]).toEqual({ kind: "same", text: "h" });
    expect(d[d.length - 1]).toEqual({ kind: "same", text: "t" });
    expect(d.filter((l) => l.kind === "same")).toHaveLength(2);
  });

  it("handles empty sides", () => {
    expect(diffLines("", "a").some((l) => l.kind === "add")).toBe(true);
    expect(diffLines("a", "").some((l) => l.kind === "del")).toBe(true);
  });
});
