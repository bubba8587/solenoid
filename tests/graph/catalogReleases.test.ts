// [[C138]] addMenuReachesAll
// Each card says the release that brought it and the last that reworked it; no `added` is 1.5 or earlier.
import { describe, it, expect } from "vitest";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { flattenLeaves } from "../../src/graph/catalogSearch";
import { addedIn } from "../../src/graph/AddNodeMenu";
import { initPackFormulas } from "../../src/graph/formulaExtensions";

initPackFormulas();
const leaves = flattenLeaves(buildCatalog(false)).map((l) => l.leaf);
const order = ["1.5", "1.6"];

describe("catalog releases", () => {
  it("a card is never reworked before it arrived", () => {
    expect(leaves.filter((l) => l.updated && order.indexOf(l.updated) <= order.indexOf(addedIn(l))).map((l) => l.type)).toEqual([]);
  });

  it("1.6's new cards are tagged", () => {
    const added = new Set(leaves.filter((l) => addedIn(l) === "1.6").map((l) => l.type));
    for (const t of ["dashboard", "pipeline", "conditional-regions", "delayed-pass", "cards", "geo-solid"]) expect(added).toContain(t);
  });
});
