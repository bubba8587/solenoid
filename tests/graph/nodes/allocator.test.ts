// [[B17]], [[C48]], [[C24]] arraySemantics
import { describe, it, expect } from "vitest";
import { AllocatorNode } from "../../../src/graph/nodes/frame";
import { type FrameValue, type FrameColumn, frameFromInputText } from "../../../src/graph/frame";
import { isSolError } from "../../../src/graph/errorValue";
import type { AllocateMode } from "../../../src/graph/nodes/allocateOps";
import { extractInit } from "../../../src/graph/nodeInit";
import seed from "../../../src/graph/seedGraphs/allocator.json";

const frame = (columns: FrameColumn[]): FrameValue => ({ __frame: true, columns });
const cats = frame([
  { name: "Category", type: "string", values: ["Car", "Other"] },
  { name: "Min", type: "number", values: [20, 10] },
  { name: "Max", type: "number", values: [50, 40] },
]);
const allocOf = (out: { frame: FrameValue | unknown }): unknown[] =>
  (out.frame as FrameValue).columns.find((c) => c.name === "Allocation")!.values;
// Weights are an ordered column on the frame (orderedColumnsAreFrames), never a wired list.
const wcats = (weights: number[]): FrameValue =>
  frame([...cats.columns, { name: "Weight", type: "number", values: weights }]);

describe("AllocatorNode", () => {
  it("fits a budget by weight, clamped to each range (the worked example)", () => {
    const n = new AllocatorNode();
    n.literals.amount = 60;
    expect(allocOf(n.data({ categories: [cats] }))).toEqual([30, 30]);          // no Weight column → equal
  });

  it("emits Category, Allocation, and Share as a raw fraction of the spend", () => {
    const n = new AllocatorNode();
    n.literals.amount = 60;
    const cols = (n.data({ categories: [wcats([1, 3])] }).frame as FrameValue).columns;
    const col = (name: string) => cols.find((c) => c.name === name)!.values;
    expect(cols.map((c) => c.name)).toEqual(["Category", "Allocation", "Share"]);
    expect(col("Allocation")).toEqual([20, 40]);
    expect(col("Share")).toEqual([1 / 3, 2 / 3]); // raw decimal, formatted downstream
  });

  it("min-for-target buys the most-valued category first", () => {
    const zero = frame([
      { name: "Category", type: "string", values: ["A", "B"] },
      { name: "Min", type: "number", values: [0, 0] },
      { name: "Max", type: "number", values: [100, 100] },
      { name: "Weight", type: "number", values: [3, 1] },
    ]);
    const n = new AllocatorNode({ mode: "minTarget" });
    n.literals.amount = 150;
    expect(allocOf(n.data({ categories: [zero] }))).toEqual([50, 0]);
  });

  it("min-proportional scales up from the binding floor", () => {
    const n = new AllocatorNode({ mode: "minProportional" });
    const wide = frame([
      { name: "Category", type: "string", values: ["Car", "Other"] },
      { name: "Min", type: "number", values: [20, 10] },
      { name: "Max", type: "number", values: [1000, 1000] },
      { name: "Weight", type: "number", values: [1, 3] },
    ]);
    expect(allocOf(n.data({ categories: [wide] }))).toEqual([20, 60]);
  });

  it("carries the min column's unit onto the Allocation column", () => {
    const withUnit = frame([
      { name: "Category", type: "string", values: ["Car", "Other"] },
      { name: "Min", type: "number", values: [20, 10], unit: { display: "USD", base: "USD", factor: 1 } as never },
      { name: "Max", type: "number", values: [50, 40] },
    ]);
    const n = new AllocatorNode();
    n.literals.amount = 60;
    const out = n.data({ categories: [withUnit] });
    const alloc = (out.frame as FrameValue).columns.find((c) => c.name === "Allocation")!;
    expect(alloc.unit).toBeTruthy();
  });

  it("errors when there is no min/max number column", () => {
    const bad = frame([{ name: "X", type: "string", values: ["a", "b"] }]);
    const out = new AllocatorNode().data({ categories: [bad] });
    expect(isSolError(out.frame)).toBe(true);
  });

  it("an unwired categories input yields no result, not a crash", () => {
    expect(new AllocatorNode().data({}).frame).toBeNull();
  });

  it("round-trips its op through extractInit", () => {
    const back = new AllocatorNode(extractInit(new AllocatorNode({ mode: "minProportional" })) as never);
    expect(back.mode).toBe("minProportional");
  });

  // Ties the shipped seed to a verified answer: Tech and Travel fill their small caps
  // (12k, 10k), then Car/Housing/Furniture split the remaining 78k by weight (2:3:1).
  it("computes the allocator seed's allocation", () => {
    const nodes = seed.nodes as { id: string; init?: Record<string, unknown>; literals?: Record<string, number> }[];
    const items = nodes.find((n) => n.id === "items")!;
    const alloc = nodes.find((n) => n.id === "alloc")!;
    const f = frameFromInputText(items.init!.frameText as string);
    const n = new AllocatorNode({ mode: alloc.init!.mode as never });
    n.literals.amount = alloc.literals!.amount;
    expect(allocOf(n.data({ categories: [f] }))).toEqual([26000, 39000, 13000, 12000, 10000]);
  });
});

/** One allocation through the card: a row per category, the amount as its literal (an error comes back as is). */
function alloc(mode: AllocateMode, mins: number[], maxs: number[], weights: number[], amount: number): number[] {
  const n = new AllocatorNode({ mode });
  n.literals.amount = amount;
  const out = n.data({ categories: [frame([
    { name: "Category", type: "string", values: mins.map((_, i) => `c${i}`) },
    { name: "Min", type: "number", values: mins },
    { name: "Max", type: "number", values: maxs },
    { name: "Weight", type: "number", values: weights },
  ])] }).frame;
  return isSolError(out) ? (out as never) : (allocOf({ frame: out }) as number[]);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("Fit budget (water-filling)", () => {
  // The worked example: Car [20,50], Other [10,40], budget 60.
  const mins = [20, 10], maxs = [50, 40];

  it("equal weights split the budget evenly when both land in range", () => {
    expect(alloc("budget", mins, maxs, [1, 1], 60)).toEqual([30, 30]);
  });

  it("valuing Other 3x clamps Car to its floor and Other to its cap", () => {
    expect(alloc("budget", mins, maxs, [1, 3], 60)).toEqual([20, 40]);
  });

  it("always spends exactly the budget when it's between Σmin and Σmax", () => {
    for (const w of [[2, 1], [1, 5], [3, 2]]) {
      expect(sum(alloc("budget", mins, maxs, w, 60))).toBeCloseTo(60, 6);
    }
  });

  it("keeps every category inside its own range", () => {
    const a = alloc("budget", mins, maxs, [5, 1], 55);
    expect(a[0]).toBeGreaterThanOrEqual(20); expect(a[0]).toBeLessThanOrEqual(50);
    expect(a[1]).toBeGreaterThanOrEqual(10); expect(a[1]).toBeLessThanOrEqual(40);
  });

  it("under Σmin returns the floors; over Σmax returns the caps", () => {
    expect(alloc("budget", mins, maxs, [1, 1], 20)).toEqual([20, 10]);   // 20 < Σmin 30
    expect(alloc("budget", mins, maxs, [1, 1], 200)).toEqual([50, 40]);  // 200 > Σmax 90
  });

  it("redistributes past a single cap to the remaining free categories (3-way)", () => {
    // A [0,10], B [0,10], C [0,100]; weights 1,1,1; budget 60. Even split is 20 each, but
    // A and B cap at 10, so C absorbs the rest: 10, 10, 40.
    expect(alloc("budget", [0, 0, 0], [10, 10, 100], [1, 1, 1], 60)).toEqual([10, 10, 40]);
  });

  it("frees a category that an earlier pass would have pinned at its cap", () => {
    // A [0,10], B [60,100], budget 100: B's floor is above the even split, but λ = 90 fits.
    expect(alloc("budget", [0, 60], [10, 100], [1, 1], 100)).toEqual([10, 90]);
    expect(alloc("budget", [0, 60], [10, 100], [1, 1], 100)).toEqual([10, 90]);
  });

  it("zero-weight categories absorb what the weighted ones can't hold", () => {
    expect(alloc("budget", [0, 0, 0], [10, 50, 50], [1, 0, 0], 50)).toEqual([10, 20, 20]);
  });

  it("all-zero weights fall back to an equal split", () => {
    expect(alloc("budget", [0, 0], [100, 100], [0, 0], 50)).toEqual([25, 25]);
  });
});

describe("Min for target (greedy to a value floor)", () => {
  const mins = [0, 0], maxs = [100, 100];

  it("buys value cheapest-per-dollar (highest weight) first", () => {
    // weights 3 and 1; need value 150. Fill the weight-3 category first: 100 gives value 300 > 150,
    // so 50 there (value 150), nothing from the weight-1 one.
    expect(alloc("minTarget", mins, maxs, [3, 1], 150)).toEqual([50, 0]);
  });

  it("spills to the next category once the first caps out", () => {
    // weight-3 maxes at 100 (value 300); need 400 → 100 more value from the weight-1 one → +100.
    expect(alloc("minTarget", [0, 0], [100, 100], [3, 1], 400)).toEqual([100, 100]);
  });

  it("a target beyond every cap is an error naming the most reachable", () => {
    const e = alloc("minTarget", [0, 0], [100, 100], [3, 1], 500);
    expect(isSolError(e) && e.message).toMatch(/out of reach: the most is 400/);
  });

  it("floors already meeting the target spend nothing extra", () => {
    expect(alloc("minTarget", [10, 10], [100, 100], [1, 1], 15)).toEqual([10, 10]);
  });
});

describe("Min proportional (least spend, weight-proportional)", () => {
  it("scales up from the binding floor keeping the weight ratio", () => {
    // mins [20,10], weights [1,3]: k = max(20/1, 10/3) = 20 → [20, 60], capped by maxs.
    expect(alloc("minProportional", [20, 10], [1000, 1000], [1, 3], 0)).toEqual([20, 60]);
  });

  it("clamps to max when the proportion would overshoot a cap", () => {
    expect(alloc("minProportional", [20, 10], [50, 40], [1, 3], 0)).toEqual([20, 40]);
  });
});

describe("the modes + range normalization", () => {
  it("dispatches by mode", () => {
    expect(alloc("budget", [20, 10], [50, 40], [1, 1], 60)).toEqual([30, 30]);
    expect(alloc("minProportional", [20, 10], [1000, 1000], [1, 3], 0)).toEqual([20, 60]);
  });
  it("normalizes an inverted min>max row", () => {
    // [50,20] normalizes to [20,50]; equal-weight budget 60 over [20,50]&[10,40] → 30/30.
    expect(alloc("budget", [50, 40], [20, 10], [1, 1], 60)).toEqual([30, 30]);
  });
});
