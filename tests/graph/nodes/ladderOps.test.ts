// [[C122]] choiceLadder
import { describe, it, expect } from "vitest";
import { nextChoices } from "../../../src/graph/nodes/ladderOps";

describe("Choice Ladder kernel: choices", () => {
  it("nextChoices takes, moves a retaken pick to the end, undoes by name and clears", () => {
    expect(nextChoices([], { add: "Lune" })).toEqual(["Lune"]);
    expect(nextChoices(["Lune", "Kato"], { add: "lune" })).toEqual(["Kato", "lune"]);
    expect(nextChoices(["Lune", "Kato"], { remove: " LUNE " })).toEqual(["Kato"]);
    expect(nextChoices(["Lune", "Kato"], { reset: true })).toEqual([]);
    expect(nextChoices(["Lune", "Fennel"], { add: "Kato", instead: "fennel" })).toEqual(["Lune", "Kato"]);
  });
});
