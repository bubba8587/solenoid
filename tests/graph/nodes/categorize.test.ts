// [[B19]] spreadsheetHabits, [[categorize]]
import { describe, it, expect } from "vitest";
import { CategorizeNode } from "../../../src/graph/nodes/frame";
import type { FrameValue } from "../../../src/graph/frame";
import { extractInit } from "../../../src/graph/nodeInit";
import { categoryOf, dropCategory, moveItems, nextCategoryName, readAssigned, renameCategory } from "../../../src/graph/categorizeConfig";

const rows = (f: unknown) => {
  const fr = f as FrameValue;
  return fr.columns[0].values.map((v, i) => [v, fr.columns[1].values[i]]);
};

describe("Categorize answers the lookup table", () => {
  it("sorted items come in the categories' order and drop order, the rest after with a blank category", () => {
    const n = new CategorizeNode({ assigned: [["Category 2", ["kiwi", "apple"]], ["Category 1", ["carrot"]]] });
    const out = n.data({ items: [["apple", "carrot", "apple", "", "kiwi", "leek"]] }).frame;
    expect((out as FrameValue).columns.map((c) => [c.name, c.type])).toEqual([["Item", "string"], ["Category", "string"]]);
    expect(rows(out)).toEqual([["carrot", "Category 1"], ["kiwi", "Category 2"], ["apple", "Category 2"], ["leek", ""]]);
    expect(n.sortItems).toEqual([["apple", "apple"], ["carrot", "carrot"], ["kiwi", "kiwi"], ["leek", "leek"]]);
    expect(n.sortCategories).toEqual(["Category 1", "Category 2", "Category 3"]);
  });

  it("numbers stay a Number column, keyed by their digits", () => {
    const n = new CategorizeNode({ assigned: [["Low", ["1", "2"]]] });
    n.stringLiterals.categories = "Low, High";
    const out = n.data({ items: [[3, 1, 2, 1]] }).frame as FrameValue;
    expect(out.columns[0].type).toBe("number");
    expect(rows(out)).toEqual([[1, "Low"], [2, "Low"], [3, ""]]);
  });

  it("typed categories replace the defaults; a category that goes keeps its items out of the answer, never moved", () => {
    const n = new CategorizeNode({ assigned: [["Fruit", ["apple"]], ["Veg", ["leek"]]] });
    n.stringLiterals.categories = "Fruit, Veg";
    expect(rows(n.data({ items: [["apple", "leek"]] }).frame)).toEqual([["apple", "Fruit"], ["leek", "Veg"]]);
    n.stringLiterals.categories = "Fruit";
    expect(rows(n.data({ items: [["apple", "leek"]] }).frame)).toEqual([["apple", "Fruit"], ["leek", ""]]);
    n.stringLiterals.categories = "Fruit, Veg";
    expect(rows(n.data({ items: [["leek", "apple"]] }).frame)).toEqual([["apple", "Fruit"], ["leek", "Veg"]]);
  });

  it("wired categories name the columns; no items is blank", () => {
    const n = new CategorizeNode({ assigned: [["B", ["x"]]] });
    expect(rows(n.data({ items: [["x", "y"]], categories: [["A", "B", "A", ""]] }).frame)).toEqual([["x", "B"], ["y", ""]]);
    expect(n.sortCategories).toEqual(["A", "B"]);
    expect(n.data({ items: [[]] }).frame).toBeNull();
  });

  it("the sort survives a save", () => {
    const n = new CategorizeNode({ assigned: [["A", ["x"]]] });
    const init = extractInit(n) as { assigned: unknown };
    expect(init.assigned).toEqual([["A", ["x"]]]);
    (init.assigned as [string, string[]][])[0][1].push("y");
    expect(n.assigned).toEqual([["A", ["x"]]]);
    expect(new CategorizeNode(init as never).assigned).toEqual([["A", ["x", "y"]]]);
  });
});

describe("the sort's edits", () => {
  it("moves items between categories, before a chip or at the end, and out", () => {
    let a = moveItems([], ["x", "y"], "A");
    expect(a).toEqual([["A", ["x", "y"]]]);
    a = moveItems(a, ["z"], "A", "y");
    expect(a).toEqual([["A", ["x", "z", "y"]]]);
    a = moveItems(a, ["x"], "B");
    expect([categoryOf(a, "x"), categoryOf(a, "y")]).toEqual(["B", "A"]);
    a = moveItems(a, ["x"], null);
    expect(a).toEqual([["A", ["z", "y"]]]);
  });

  it("renames carry items, a rename onto a held name merges, a dropped category unsorts its items", () => {
    const a = readAssigned([["A", ["x"]], ["B", ["y"]], ["A", ["x", "w"]], "junk"]);
    expect(a).toEqual([["A", ["x", "w"]], ["B", ["y"]]]);
    expect(renameCategory(a, "A", "C")).toEqual([["B", ["y"]], ["C", ["x", "w"]]]);
    expect(renameCategory(a, "A", "B")).toEqual([["B", ["y", "x", "w"]]]);
    expect(dropCategory(a, "B")).toEqual([["A", ["x", "w"]]]);
    expect(nextCategoryName(["Category 1", "Category 3"])).toBe("Category 4");
    expect(nextCategoryName(["Fruit"])).toBe("Category 2");
  });
});
