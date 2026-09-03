import { describe, it, expect } from "vitest";
import { allocate, allocateBudget, allocateMinTarget, allocateProportional } from "../../../src/graph/nodes/allocateOps";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocateBudget (water-filling)", () => {
  // The worked example: Car [20,50], Other [10,40], budget 60.
  const mins = [20, 10], maxs = [50, 40];

  it("equal weights split the budget evenly when both land in range", () => {
    expect(allocateBudget(mins, maxs, [1, 1], 60)).toEqual([30, 30]);
  });

  it("valuing Other 3x clamps Car to its floor and Other to its cap", () => {
    expect(allocateBudget(mins, maxs, [1, 3], 60)).toEqual([20, 40]);
  });

  it("always spends exactly the budget when it's between Σmin and Σmax", () => {
    for (const w of [[2, 1], [1, 5], [3, 2]]) {
      expect(sum(allocateBudget(mins, maxs, w, 60))).toBeCloseTo(60, 6);
    }
  });

  it("keeps every category inside its own range", () => {
    const a = allocateBudget(mins, maxs, [5, 1], 55);
    expect(a[0]).toBeGreaterThanOrEqual(20); expect(a[0]).toBeLessThanOrEqual(50);
    expect(a[1]).toBeGreaterThanOrEqual(10); expect(a[1]).toBeLessThanOrEqual(40);
  });

  it("under Σmin returns the floors; over Σmax returns the caps", () => {
    expect(allocateBudget(mins, maxs, [1, 1], 20)).toEqual([20, 10]);   // 20 < Σmin 30
    expect(allocateBudget(mins, maxs, [1, 1], 200)).toEqual([50, 40]);  // 200 > Σmax 90
  });

  it("redistributes past a single cap to the remaining free categories (3-way)", () => {
    // A [0,10], B [0,10], C [0,100]; weights 1,1,1; budget 60. Even split is 20 each, but
    // A and B cap at 10, so C absorbs the rest: 10, 10, 40.
    expect(allocateBudget([0, 0, 0], [10, 10, 100], [1, 1, 1], 60)).toEqual([10, 10, 40]);
  });

  it("all-zero weights fall back to an equal split", () => {
    expect(allocateBudget([0, 0], [100, 100], [0, 0], 50)).toEqual([25, 25]);
  });
});

describe("allocateMinTarget (greedy to a value floor)", () => {
  const mins = [0, 0], maxs = [100, 100];

  it("buys value cheapest-per-dollar (highest weight) first", () => {
    // weights 3 and 1; need value 150. Fill the weight-3 category first: 100 gives value 300 > 150,
    // so 50 there (value 150), nothing from the weight-1 one.
    expect(allocateMinTarget(mins, maxs, [3, 1], 150)).toEqual([50, 0]);
  });

  it("spills to the next category once the first caps out", () => {
    // weight-3 maxes at 100 (value 300); need 400 → 100 more value from the weight-1 one → +100.
    expect(allocateMinTarget([0, 0], [100, 100], [3, 1], 400)).toEqual([100, 100]);
  });

  it("floors already meeting the target spend nothing extra", () => {
    expect(allocateMinTarget([10, 10], [100, 100], [1, 1], 15)).toEqual([10, 10]);
  });
});

describe("allocateProportional (least spend, weight-proportional)", () => {
  it("scales up from the binding floor keeping the weight ratio", () => {
    // mins [20,10], weights [1,3]: k = max(20/1, 10/3) = 20 → [20, 60], capped by maxs.
    expect(allocateProportional([20, 10], [1000, 1000], [1, 3])).toEqual([20, 60]);
  });

  it("clamps to max when the proportion would overshoot a cap", () => {
    expect(allocateProportional([20, 10], [50, 40], [1, 3])).toEqual([20, 40]);
  });
});

describe("allocate dispatch + range normalization", () => {
  it("dispatches by mode", () => {
    expect(allocate("budget", [20, 10], [50, 40], [1, 1], 60)).toEqual([30, 30]);
    expect(allocate("minProportional", [20, 10], [1000, 1000], [1, 3], 0)).toEqual([20, 60]);
  });
  it("normalizes an inverted min>max row", () => {
    // [50,20] normalizes to [20,50]; equal-weight budget 60 over [20,50]&[10,40] → 30/30.
    expect(allocate("budget", [50, 40], [20, 10], [1, 1], 60)).toEqual([30, 30]);
  });
});
