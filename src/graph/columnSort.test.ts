import { describe, it, expect } from "vitest";
import { sortKeyOf, sortedOrder, type ColumnSort } from "./components/columnSort";
import { solError } from "./errorValue";

// The visual-only popup sort. Only the PURE parts are pinned here (the vitest env is
// node — no component rendering): what a cell reduces to, and the row order that
// falls out. The invariant the popups depend on is that `sortedOrder` returns SOURCE
// row indices — every caller keeps writing edits to the row the user is looking at.

const asc = (col: number): ColumnSort => ({ col, dir: "asc" });
const desc = (col: number): ColumnSort => ({ col, dir: "desc" });
const keyOf = (grid: unknown[][]) => (r: number, c: number) => sortKeyOf(grid[r]?.[c]);

describe("sortKeyOf — what a cell reduces to", () => {
  it("reads numbers as numbers, including numeric-looking and FORMATTED text", () => {
    expect(sortKeyOf(42)).toBe(42);
    expect(sortKeyOf("42")).toBe(42);
    expect(sortKeyOf(" -3.5 ")).toBe(-3.5);
    expect(sortKeyOf("1,234")).toBe(1234); // a thousands-formatted cell still sorts by magnitude
  });

  it("reads text as text, and booleans as 0/1", () => {
    expect(sortKeyOf("banana")).toBe("banana");
    expect(sortKeyOf(true)).toBe(1);
    expect(sortKeyOf(false)).toBe(0);
  });

  it("has NOTHING to sort on for a blank, a non-finite number, or a container", () => {
    for (const v of [null, undefined, "", "   ", NaN, Infinity, { __frame: true }, [1, 2]]) {
      expect(sortKeyOf(v)).toBeNull();
    }
  });

  it("sorts errors by their code, so failures group together", () => {
    expect(sortKeyOf(solError("#REF!", "gone"))).toBe("#REF!");
  });
});

describe("sortedOrder — SOURCE row indices in display order", () => {
  const grid = [["b", 2], ["a", 10], ["c", 1]];

  it("is the identity when unsorted, so a caller maps through it unconditionally", () => {
    expect(sortedOrder(3, null, keyOf(grid))).toEqual([0, 1, 2]);
  });

  it("orders text alphabetically and reverses on desc", () => {
    expect(sortedOrder(3, asc(0), keyOf(grid))).toEqual([1, 0, 2]);
    expect(sortedOrder(3, desc(0), keyOf(grid))).toEqual([2, 0, 1]);
  });

  it("orders numbers by MAGNITUDE, not as text (10 after 2)", () => {
    expect(sortedOrder(3, asc(1), keyOf(grid))).toEqual([2, 0, 1]);
  });

  it("sorts mixed text naturally — item2 before item10", () => {
    const g = [["item10"], ["item2"], ["item1"]];
    expect(sortedOrder(3, asc(0), keyOf(g))).toEqual([2, 1, 0]);
  });

  it("keeps blanks LAST in both directions — a descending sort never leads with them", () => {
    const g = [["b"], [""], ["a"], [null]];
    expect(sortedOrder(4, asc(0), keyOf(g))).toEqual([2, 0, 1, 3]);
    expect(sortedOrder(4, desc(0), keyOf(g))).toEqual([0, 2, 1, 3]);
  });

  it("keeps source order for ties, so an equal-valued column doesn't shuffle", () => {
    const g = [["x", 1], ["x", 2], ["x", 3]];
    expect(sortedOrder(3, asc(0), keyOf(g))).toEqual([0, 1, 2]);
    expect(sortedOrder(3, desc(0), keyOf(g))).toEqual([0, 1, 2]);
  });

  it("sorts a date column CHRONOLOGICALLY when keyed on the raw serial", () => {
    // The popups key off the raw grid for exactly this reason: these same dates
    // rendered as "20-Mar-2026" / "01-Apr-2026" would sort alphabetically.
    const serials = [[46110], [46021], [46387]];
    expect(sortedOrder(3, asc(0), keyOf(serials))).toEqual([1, 0, 2]);
  });
});
