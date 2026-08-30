import { describe, it, expect } from "vitest";
import { extractInlineRefs } from "../../src/graph/noteInlineRefs";

describe("extractInlineRefs", () => {
  it("finds multiple refs in source order, de-duplicated", () => {
    const body = "`=a` then `=b` then `=a` again.";
    expect(extractInlineRefs(body)).toEqual(["a", "b"]);
  });

  it("ignores a plain code span (not a ref)", () => {
    expect(extractInlineRefs("Run `npm install` first.")).toEqual([]);
  });

  it("ignores a bare `=` with no identifier", () => {
    expect(extractInlineRefs("`=` and `= ` are not refs.")).toEqual([]);
  });

  it("requires the identifier grammar (letters/digits/underscore, no leading digit)", () => {
    expect(extractInlineRefs("`=1abc` is not a ref, but `=abc1` is.")).toEqual(["abc1"]);
  });

  it("returns empty for a body with no refs", () => {
    expect(extractInlineRefs("Just plain prose.")).toEqual([]);
  });

  it("the `!` highlight flag is display-only: key is the bare name, deduped with the plain form", () => {
    expect(extractInlineRefs("Rate is `=rate!` (target `=rate`).")).toEqual(["rate"]);
    expect(extractInlineRefs("`=a!` and `=b`")).toEqual(["a", "b"]);
  });
});
