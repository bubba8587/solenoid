import { describe, it, expect } from "vitest";
import { wrapText } from "./textOps";

// R stringr::str_wrap / Python textwrap.wrap references, worked by hand (greedy,
// whitespace-collapsing, long words unbroken on their own line).
describe("wrapText (str_wrap / textwrap.wrap)", () => {
  it("greedily fills lines to the width in whole words", () => {
    expect(wrapText("the quick brown fox jumps", 10)).toEqual(["the quick", "brown fox", "jumps"]);
  });

  it("collapses runs of whitespace and ignores leading/trailing space", () => {
    expect(wrapText("  a   b\tc\n d  ", 3)).toEqual(["a b", "c d"]);
  });

  it("emits a word longer than width alone on its line, unbroken", () => {
    expect(wrapText("a supercalifragilistic b", 5)).toEqual(["a", "supercalifragilistic", "b"]);
  });

  it("clamps a sub-1 width to 1 (one word per line)", () => {
    expect(wrapText("one two three", 0)).toEqual(["one", "two", "three"]);
  });

  it("empty or blank text is no lines", () => {
    expect(wrapText("", 40)).toEqual([]);
    expect(wrapText("   \t\n ", 40)).toEqual([]);
  });

  it("counts code points, not UTF-16 units", () => {
    // Two astral emoji (2 code points) fit a width-4 line with a 1-char word between.
    expect(wrapText("😀 x 😀", 3)).toEqual(["😀 x", "😀"]);
  });
});
