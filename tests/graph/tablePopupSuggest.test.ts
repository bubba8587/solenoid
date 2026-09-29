// [[C58]] tableInputRawText
import { describe, it, expect } from "vitest";
import { listInViewOrder, suggestionCells } from "../../src/graph/components/TablePopup";
import { distinctColumnValues } from "../../src/graph/frameVerbs";

describe("suggestionCells", () => {
  it("a list suggests from all its items, whichever one is being edited", () => {
    const grid = [["red", "green", "red", "blue"]];
    expect(distinctColumnValues(suggestionCells(grid, 0, true)).sort()).toEqual(["blue", "green", "red"]);
    expect(distinctColumnValues(suggestionCells(grid, 2, true)).sort()).toEqual(["blue", "green", "red"]);
  });

  it("a table suggests from the edited column", () => {
    expect(suggestionCells([["a", "x"], ["b", "y"]], 1, false)).toEqual(["x", "y"]);
  });
});

describe("listInViewOrder", () => {
  it("a vertical list follows the sort, as Copy as Markdown and Copy do", () => {
    expect(listInViewOrder(["b", "c", "a"], true, [2, 0, 1])).toEqual(["a", "b", "c"]);
  });
  it("a horizontal list keeps its order", () => {
    expect(listInViewOrder(["b", "c", "a"], false, [2, 0, 1])).toEqual(["b", "c", "a"]);
  });
});
