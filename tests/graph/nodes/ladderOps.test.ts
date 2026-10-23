// [[C122]] choiceLadder
import { describe, it, expect } from "vitest";
import { bestPlan, isClose, nextChoices, type LadderOption } from "../../../src/graph/nodes/ladderOps";

const opt = (score: number, costs: number[] = [], requires: number[] = [], excludes: number[] = []): LadderOption =>
  ({ score, value: [score], costs, requires, excludes });

describe("Choice Ladder kernel: choices", () => {
  it("nextChoices takes, moves a retaken pick to the end, undoes by name and clears", () => {
    expect(nextChoices([], { add: "Lune" })).toEqual(["Lune"]);
    expect(nextChoices(["Lune", "Kato"], { add: "lune" })).toEqual(["Kato", "lune"]);
    expect(nextChoices(["Lune", "Kato"], { remove: " LUNE " })).toEqual(["Kato"]);
    expect(nextChoices(["Lune", "Kato"], { reset: true })).toEqual([]);
    expect(nextChoices(["Lune", "Fennel"], { add: "Kato", instead: "fennel" })).toEqual(["Lune", "Kato"]);
  });
});

describe("Choice Ladder kernel: pieces", () => {
  it("close is a share of the larger place, within one tier", () => {
    expect(isClose({ tier: 1, p: 1 }, { tier: 1, p: 0.96 }, 0.05)).toBe(true);
    expect(isClose({ tier: 1, p: 1 }, { tier: 1, p: 0.94 }, 0.05)).toBe(false);
    expect(isClose({ tier: 0, p: 1 }, { tier: 1, p: 1 }, 0.05)).toBe(false);
  });
  it("bestPlan honors Excludes within a countable limit", () => {
    const opts = [opt(0.9, [1], [], [1]), opt(0.8, [1], [], [0]), opt(0.3, [1])];
    expect(bestPlan(opts, [0, 1, 2], [], [2])!.sort()).toEqual([0, 2]);
  });
});

describe("Choice Ladder kernel: floors", () => {
  it("bestPlan meets a floor at the least cost in score, and says null when none can", () => {
    // value, [budget, veg]
    const opts = [opt(0.9, [5, 0]), opt(0.8, [5, 0]), opt(0.5, [5, 1]), opt(0.4, [5, 1])];
    expect(bestPlan(opts, [0, 1, 2, 3], [], [10, null])!.sort()).toEqual([0, 1]);
    expect(bestPlan(opts, [0, 1, 2, 3], [], [10, null], [0, 1])!.sort()).toEqual([0, 2]);
    expect(bestPlan(opts, [0, 1, 2, 3], [], [10, null], [0, 3])).toBeNull();
  });
});

describe("Choice Ladder kernel: round-3 review", () => {
  it("a worthless option is taken when there's room, and a prerequisite worth nothing comes when needed", () => {
    expect(bestPlan([opt(0.9, [10]), opt(0.5, [10]), opt(0, [10])], [0, 1, 2], [], [100])!.sort()).toEqual([0, 1, 2]);
    expect(bestPlan([opt(0.9, [5], [2]), opt(0.3, [5]), opt(-0.1, [5])], [0, 1, 2], [], [10])!.sort()).toEqual([0, 2]);
  });
});
