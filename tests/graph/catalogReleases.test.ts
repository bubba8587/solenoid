// [[A1]] visualGraphCalculator, [[add-menu#The Add menu reaches every node, in a shape the author designs by hand]]
// Each card says the release that brought it and the last that reworked it; no `added` is 1.5 or earlier.
import { describe, it, expect } from "vitest";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { flattenLeaves } from "../../src/graph/catalogSearch";
import { addedIn } from "../../src/graph/AddNodeMenu";
import { initPackFormulas } from "../../src/graph/formulaExtensions";
import { NEXT_RELEASE, compareRelease } from "../../src/graph/release";
import pkg from "../../package.json";

initPackFormulas();
const leaves = flattenLeaves(buildCatalog(false)).map((l) => l.leaf);

describe("catalog releases", () => {
  it("a card is never reworked before it arrived", () => {
    expect(leaves.filter((l) => l.updated && compareRelease(l.updated, addedIn(l)) <= 0).map((l) => l.type)).toEqual([]);
  });

  it("NEXT_RELEASE is after the app's version, so unreleased work never wears a shipped number", () => {
    expect(compareRelease(NEXT_RELEASE, pkg.version)).toBeGreaterThan(0);
  });

  it("no card claims a release after NEXT_RELEASE", () => {
    const late = leaves.filter((l) => compareRelease(addedIn(l), NEXT_RELEASE) > 0 || (l.updated && compareRelease(l.updated, NEXT_RELEASE) > 0));
    expect(late.map((l) => l.type)).toEqual([]);
  });

  it("compareRelease reads a missing part as 0", () => {
    expect(compareRelease("1.6", "1.6.0")).toBe(0);
    expect(compareRelease("1.6.1", "1.6")).toBeGreaterThan(0);
    expect(compareRelease("1.10", "1.9.9")).toBeGreaterThan(0);
  });

  it("1.6's new cards are tagged", () => {
    const added = new Set(leaves.filter((l) => addedIn(l) === "1.6").map((l) => l.type));
    for (const t of ["dashboard", "pipeline", "conditional-regions", "delayed-pass", "cards", "geo-solid"]) expect(added).toContain(t);
  });
});
