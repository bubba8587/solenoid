import { describe, it, expect } from "vitest";
import { withinOneEdit, tokenWordScore } from "../../src/graph/fuzzy";

describe("withinOneEdit — one Damerau-Levenshtein edit", () => {
  it("accepts equal words and each single-edit kind", () => {
    expect(withinOneEdit("frame", "frame")).toBe(true);
    expect(withinOneEdit("frane", "frame")).toBe(true); // substitution
    expect(withinOneEdit("frmae", "frame")).toBe(true); // adjacent transposition
    expect(withinOneEdit("frme", "frame")).toBe(true); // deletion
    expect(withinOneEdit("fraame", "frame")).toBe(true); // insertion
    expect(withinOneEdit("xlokup", "xlookup")).toBe(true);
  });

  it("rejects two or more edits", () => {
    expect(withinOneEdit("frnae", "frame")).toBe(false); // non-adjacent swap = 2 subs
    expect(withinOneEdit("fane", "frame")).toBe(false); // deletion + substitution
    expect(withinOneEdit("fr", "frame")).toBe(false);
    expect(withinOneEdit("frame", "fravne")).toBe(false); // sub + insertion
  });
});

describe("tokenWordScore — exact ≫ prefix ≫ one-edit typo", () => {
  it("tiers exact, prefix, and typo hits", () => {
    expect(tokenWordScore("frame", ["frame", "input"])).toBe(150);
    expect(tokenWordScore("fra", ["frame"])).toBe(100);
    expect(tokenWordScore("frane", ["frame"])).toBe(90);
    expect(tokenWordScore("pivot", ["frame", "input"])).toBe(0);
  });

  it("gives short tokens no typo tolerance ('sun' must not reach 'sum')", () => {
    expect(tokenWordScore("sun", ["sum"])).toBe(0);
    expect(tokenWordScore("sum", ["sum"])).toBe(150);
  });
});
