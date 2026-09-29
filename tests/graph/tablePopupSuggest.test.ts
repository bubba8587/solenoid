// [[C58]] tableInputRawText
import { describe, it, expect } from "vitest";
import { suggestionCells } from "../../src/graph/components/TablePopup";
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
