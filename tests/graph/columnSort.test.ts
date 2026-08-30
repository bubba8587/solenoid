import { describe, it, expect } from "vitest";
import { sortKeyOf, sortedOrder, sortDirOf, nextSort, remapSort, type ColumnSort } from "../../src/graph/components/columnSort";
import { solError } from "../../src/graph/errorValue";

// The visual-only popup sort. Only the PURE parts are pinned here (the vitest env is
// node — no component rendering): what a cell reduces to, and the row order that
// falls out. The invariant the popups depend on is that `sortedOrder` returns SOURCE
// row indices — every caller keeps writing edits to the row the user is looking at.

const asc = (col: number): ColumnSort => [{ col, dir: "asc" }];
const desc = (col: number): ColumnSort => [{ col, dir: "desc" }];
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
    expect(sortedOrder(3, [], keyOf(grid))).toEqual([0, 1, 2]);
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

  it("tiers a MIXED column — all numbers (numeric order) before all text", () => {
    // The regression: number pairs compared numerically but a number-vs-text pair
    // compared AS TEXT, and for negatives those two orders disagree ("-1…" < "-2…"
    // textually) — an intransitive comparator, so Array.sort could emit -2 AFTER -1.
    const col = [-1, "-1a", -2, "-3x", 5, "apple"];
    const shown = sortedOrder(col.length, asc(0), keyOf(col.map((v) => [v]))).map((r) => col[r]);
    expect(shown.slice(0, 3)).toEqual([-2, -1, 5]); // numbers first, by magnitude
    expect(shown.slice(3).every((v) => typeof v === "string")).toBe(true);
  });

  it("gives ONE order for a multiset regardless of the input permutation", () => {
    // Transitivity's observable face: with a total order, the sorted output is a
    // function of the VALUES, not of where the sort algorithm happened to start.
    const a: Array<string | number> = [-1, "-1a", -2, "-3x", 5, "apple"];
    const b = [...a].reverse();
    const sortAll = (col: Array<string | number>) =>
      sortedOrder(col.length, asc(0), keyOf(col.map((v) => [v]))).map((r) => col[r]);
    expect(sortAll(a)).toEqual(sortAll(b));
  });

  it("sorts a date column CHRONOLOGICALLY when keyed on the raw serial", () => {
    // The popups key off the raw grid for exactly this reason: these same dates
    // rendered as "20-Mar-2026" / "01-Apr-2026" would sort alphabetically.
    const serials = [[46110], [46021], [46387]];
    expect(sortedOrder(3, asc(0), keyOf(serials))).toEqual([1, 0, 2]);
  });
});

describe("multi-column sort — Excel's add-a-level model", () => {
  // Category / Name / Qty. Rows chosen so Category alone leaves ties for Name to break.
  const grid = [
    ["fruit", "pear", 3],
    ["veg", "leek", 1],
    ["fruit", "apple", 2],
    ["veg", "carrot", 9],
  ];
  const k = keyOf(grid);

  it("consults keys in PRIORITY order — the first that separates two rows decides", () => {
    // Category, then Name: fruits before veg, alphabetical within each.
    const sort: ColumnSort = [{ col: 0, dir: "asc" }, { col: 1, dir: "asc" }];
    expect(sortedOrder(4, sort, k)).toEqual([2, 0, 3, 1]);
    // Swap the priority and the grouping changes completely.
    const flipped: ColumnSort = [{ col: 1, dir: "asc" }, { col: 0, dir: "asc" }];
    expect(sortedOrder(4, flipped, k)).toEqual([2, 3, 1, 0]);
  });

  it("mixes directions per key — category ascending, name descending within it", () => {
    const sort: ColumnSort = [{ col: 0, dir: "asc" }, { col: 1, dir: "desc" }];
    expect(sortedOrder(4, sort, k)).toEqual([0, 2, 1, 3]);
  });

  it("walks the author's own worked example: add, add, clear, re-add", () => {
    // "sort category, then Name, it sorts category then Name"
    let s: ColumnSort = [];
    s = nextSort(s, 0);
    expect(s).toEqual([{ col: 0, dir: "asc" }]);
    s = nextSort(s, 1);
    expect(s).toEqual([{ col: 0, dir: "asc" }, { col: 1, dir: "asc" }]);
    // "clear category, it's just Name" — desc, then a third click drops it.
    s = nextSort(s, 0);
    s = nextSort(s, 0);
    expect(s).toEqual([{ col: 1, dir: "asc" }]);
    // "add category back, it's name then category" — it lands at the END.
    s = nextSort(s, 0);
    expect(s).toEqual([{ col: 1, dir: "asc" }, { col: 0, dir: "asc" }]);
  });

  it("keeps a key's PLACE when only its direction changes", () => {
    let s: ColumnSort = [{ col: 0, dir: "asc" }, { col: 1, dir: "asc" }];
    s = nextSort(s, 0); // asc → desc, still primary
    expect(s).toEqual([{ col: 0, dir: "desc" }, { col: 1, dir: "asc" }]);
  });

  it("lets a LATER key break a tie the earlier one leaves blank on both sides", () => {
    const g = [["x", null, 2], ["x", null, 1]];
    const sort: ColumnSort = [{ col: 1, dir: "asc" }, { col: 2, dir: "asc" }];
    expect(sortedOrder(2, sort, keyOf(g))).toEqual([1, 0]);
  });

  it("sortDirOf reports a column's direction, or null when it isn't a key", () => {
    const sort: ColumnSort = [{ col: 3, dir: "desc" }];
    expect(sortDirOf(sort, 3)).toBe("desc");
    expect(sortDirOf(sort, 1)).toBeNull();
    expect(sortDirOf([], 3)).toBeNull();
  });
});

describe("remapSort — the sort under structural column changes", () => {
  // The popups call this from remove-column / CSV reshape so a stale key can't
  // re-attach to whatever column slides into its index.
  const removal = (removed: number) => (col: number) =>
    col === removed ? null : col > removed ? col - 1 : col;

  it("drops the removed column's key and shifts higher indices down", () => {
    const s: ColumnSort = [{ col: 0, dir: "asc" }, { col: 2, dir: "desc" }];
    expect(remapSort(s, removal(1))).toEqual([{ col: 0, dir: "asc" }, { col: 1, dir: "desc" }]);
    expect(remapSort(s, removal(2))).toEqual([{ col: 0, dir: "asc" }]);
  });

  it("keeps the surviving keys' PRIORITY order across a drop", () => {
    const s: ColumnSort = [{ col: 2, dir: "asc" }, { col: 0, dir: "desc" }, { col: 1, dir: "asc" }];
    expect(remapSort(s, removal(2))).toEqual([{ col: 0, dir: "desc" }, { col: 1, dir: "asc" }]);
  });

  it("clears outright when the map rejects every key (the CSV-reshape case)", () => {
    expect(remapSort([{ col: 0, dir: "asc" }, { col: 3, dir: "desc" }], () => null)).toEqual([]);
  });

  it("is the identity for an empty sort", () => {
    expect(remapSort([], removal(0))).toEqual([]);
  });
});
